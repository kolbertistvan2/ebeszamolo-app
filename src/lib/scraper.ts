import { chromium, Page, Browser } from 'playwright-core';
import Browserbase from '@browserbasehq/sdk';
import { CompanyFinancialReport } from './types';

const COMPANY_SUFFIXES = [
  'Nyrt.', 'Nyrt', 'Zrt.', 'Zrt', 'Kft.', 'Kft', 'Bt.', 'Bt',
  'Kkt.', 'Kkt', 'Rt.', 'Rt', 'Szövetkezet', 'Egyesülés', 'Alapítvány', 'Egyesület',
];

function normalizeCompanyName(companyName: string): string {
  let normalized = companyName.trim();
  for (const suffix of COMPANY_SUFFIXES) {
    const regex = new RegExp(`\\s*${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    normalized = normalized.replace(regex, '');
  }
  return normalized.trim();
}

export interface ScrapeResult {
  report: CompanyFinancialReport | null;
  liveViewUrl: string | null;
  sessionId: string | null;
}

export class EBeszamoloScraper {
  private browser: Browser | null = null;
  private bb: Browserbase | null = null;
  private sessionId: string | null = null;
  private liveViewUrl: string | null = null;
  private readonly baseURL = 'https://e-beszamolo.im.gov.hu';
  private termsAccepted = false;

  async initialize(): Promise<{ sessionId: string; liveViewUrl: string }> {
    this.bb = new Browserbase({
      apiKey: process.env.BROWSERBASE_API_KEY!,
    });

    const session = await this.bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      browserSettings: {
        fingerprint: {
          browsers: ['chrome'],
          devices: ['desktop'],
          operatingSystems: ['windows'],
        },
        viewport: {
          width: 1280,
          height: 720,
        },
      },
    });

    this.sessionId = session.id;
    console.log(`✓ Browserbase session created: ${session.id}`);

    // Get live view URL
    const debugInfo = await this.bb.sessions.debug(session.id);
    this.liveViewUrl = debugInfo.debuggerFullscreenUrl;
    console.log(`✓ Live view URL: ${this.liveViewUrl}`);

    this.browser = await chromium.connectOverCDP(session.connectUrl);
    console.log('✓ Browser connected');

    return {
      sessionId: this.sessionId,
      liveViewUrl: this.liveViewUrl,
    };
  }

  getLiveViewUrl(): string | null {
    return this.liveViewUrl;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async close() {
    await this.browser?.close();
    console.log('✓ Browser closed');
  }

  async scrapeByTaxNumber(
    taxNumber: string,
    targetYear: number = 2024
  ): Promise<CompanyFinancialReport | null> {
    const taxNumberClean = taxNumber.replace(/[^0-9]/g, '').substring(0, 8);
    console.log(`Processing tax number: ${taxNumberClean}`);

    try {
      const report = await this.scrapeCompany({ type: 'taxNumber', value: taxNumberClean }, targetYear);
      if (report) {
        console.log(`✓ Successfully scraped: ${report.companyName}`);
        return report;
      }
    } catch (error) {
      console.error(`✗ Error: ${error instanceof Error ? error.message : error}`);
    }

    return null;
  }

  async scrapeSingleCompany(
    companyName: string,
    targetYear: number = 2024
  ): Promise<CompanyFinancialReport | null> {
    console.log(`Processing: ${companyName}`);
    const normalizedName = normalizeCompanyName(companyName);
    console.log(`Normalized name: ${normalizedName}`);

    try {
      const report = await this.scrapeCompany({ type: 'name', value: normalizedName }, targetYear, companyName);
      if (report) {
        console.log(`✓ Successfully scraped: ${companyName}`);
        return report;
      }
    } catch (error) {
      console.error(`✗ Error: ${error instanceof Error ? error.message : error}`);
    }

    return null;
  }

  private async scrapeCompany(
    search: { type: 'name' | 'taxNumber'; value: string },
    targetYear: number,
    originalName?: string
  ): Promise<CompanyFinancialReport | null> {
    const defaultContext = this.browser!.contexts()[0];
    const page = defaultContext.pages()[0] || await defaultContext.newPage();

    try {
      console.log('  → Navigating to search page...');
      await page.goto(`${this.baseURL}/oldal/beszamolo_kereses`, {
        waitUntil: 'networkidle'
      });

      const fillAndSubmit = async () => {
        if (search.type === 'taxNumber') {
          console.log('  → Searching by tax number...');
          await page.fill('input#firmTaxNumber', search.value);
        } else {
          console.log('  → Searching by company name...');
          await page.fill('input#firmName', search.value);
        }
        await page.click('button#btnSubmit');
      };

      await fillAndSubmit();

      const popupHandled = await this.handleTermsPopup(page);
      if (popupHandled) {
        await fillAndSubmit();
        await this.delay(2000);
      }

      await page.waitForSelector('table tbody tr td a[href="#"]', { timeout: 15000 });
      await this.delay(1000);

      const bestMatch = await page.evaluate((args: { searchTerm: string; isTaxSearch: boolean }) => {
        const { searchTerm, isTaxSearch } = args;
        const tables = Array.from(document.querySelectorAll('table'));
        const resultsTable = tables.find(t => t.querySelector('th')?.textContent?.includes('Cégnév'));
        if (!resultsTable) return { found: false, index: 0 };
        const rows = Array.from(resultsTable.querySelectorAll('tbody tr'));

        const allRows: { index: number; nameCount: number; exact: boolean }[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const firstCell = row.querySelector('td:first-child');
          if (!firstCell) continue;

          const link = firstCell.querySelector('a');
          if (!link) continue;

          const brCount = link.querySelectorAll('br').length;
          const nameCount = brCount + 1;
          allRows.push({ index: i, nameCount, exact: false });
        }

        if (isTaxSearch) {
          if (allRows.length === 0) return { found: false, index: 0 };
          allRows.sort((a, b) => a.nameCount - b.nameCount);
          return { found: true, index: allRows[0].index };
        }

        const searchUpper = searchTerm.toUpperCase();
        const suffixes = ['KFT', 'KFT.', 'ZRT', 'ZRT.', 'NYRT', 'NYRT.', 'BT', 'BT.',
                        'KKT', 'KKT.', 'RT', 'RT.', 'KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG',
                        'ZÁRTKÖRŰEN MŰKÖDŐ RÉSZVÉNYTÁRSASÁG', 'BETÉTI TÁRSASÁG'];

        const stripSuffix = (name: string): string => {
          let result = name.toUpperCase().trim();
          for (const suffix of suffixes) {
            if (result.endsWith(suffix)) {
              result = result.slice(0, -suffix.length).trim();
            }
          }
          return result;
        };

        const searchStripped = stripSuffix(searchUpper);
        const matches: { index: number; nameCount: number; exact: boolean }[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const firstCell = row.querySelector('td:first-child');
          if (!firstCell) continue;

          const link = firstCell.querySelector('a');
          if (!link) continue;

          const cellText = firstCell.textContent || '';
          const names = cellText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);

          let foundExact = false;
          for (const name of names) {
            const nameStripped = stripSuffix(name);
            if (nameStripped === searchStripped) {
              matches.push({ index: i, nameCount: names.length, exact: true });
              foundExact = true;
              break;
            }
          }
          if (!foundExact) {
            for (const name of names) {
              const nameStripped = stripSuffix(name);
              if (nameStripped.startsWith(searchStripped)) {
                matches.push({ index: i, nameCount: names.length, exact: false });
                break;
              }
            }
          }
        }

        if (matches.length > 0) {
          matches.sort((a, b) => {
            if (a.exact !== b.exact) return a.exact ? -1 : 1;
            return a.nameCount - b.nameCount;
          });
          return { found: true, index: matches[0].index };
        }

        return { found: false, index: rows.length - 1 };
      }, { searchTerm: search.value, isTaxSearch: search.type === 'taxNumber' });

      const resultLinks = await page.$$('table:has(th:text("Cégnév")) tbody tr td:first-child a');
      if (resultLinks.length === 0) {
        console.log('  ✗ No search results found');
        return null;
      }

      const resultLink = resultLinks[bestMatch.index];
      if (!resultLink) {
        console.log('  ✗ No search results found');
        return null;
      }

      await resultLink.click();
      await page.waitForLoadState('networkidle');

      console.log('  → Extracting company information...');
      const companyInfo = await page.evaluate(() => {
        const text = document.body.innerText;
        const nameMatch = text.match(/Cég neve:\s*([^\n\t]+)/);
        const regMatch = text.match(/(?:Cégjegyzékszáma|Nyilvántartási szám):\s*(\d{2}-\d{2}-\d{6})/);
        const taxMatch = text.match(/Adószám:\s*([\d-]+)/);
        const hqMatch = text.match(/Székhely:\s*([^\n]+)/);

        return {
          companyName: nameMatch ? nameMatch[1].trim() : '',
          registrationNumber: regMatch ? regMatch[1] : '',
          taxNumber: taxMatch ? taxMatch[1] : '',
          headquarter: hqMatch ? hqMatch[1].trim() : ''
        };
      });

      console.log(`  → Looking for financial reports for year ${targetYear}...`);

      // Keressük meg a megfelelő évre vonatkozó beszámolót
      // Az oldalon a beszámolók div.balance-container elemekben vannak
      // Bennük: link + közzétételi dátum + tárgyév (pl. "2023. január 01. - 2023. december 31.")
      const reportSearchResult = await page.evaluate((year: number) => {
        // Keressük a balance-container div-eket
        const containers = document.querySelectorAll('div.balance-container');

        // Gyűjtsük össze az elérhető éveket
        const availableYears: number[] = [];

        for (const container of Array.from(containers)) {
          const containerText = container.textContent || '';

          // Keressük az évszámot a december 31. előtt
          const yearMatch = containerText.match(/(\d{4})\.\s*december\s*31/i);
          if (yearMatch) {
            availableYears.push(parseInt(yearMatch[1]));
          }

          // Keressük a tárgyév mintáját: "YYYY. december 31."
          const yearPattern = new RegExp(`${year}\\.\\s*december\\s*31`, 'i');
          if (yearPattern.test(containerText)) {
            // Megtaláltuk - keressük meg benne a beszámoló linket
            const link = container.querySelector('a.view-obr-balance-link');
            if (link) {
              // Visszaadjuk a link selectorját
              return {
                found: true,
                selector: 'a.view-obr-balance-link[data-code="' + link.getAttribute('data-code') + '"]',
                availableYears
              };
            }
          }
        }

        // Nem találtuk meg a keresett évet
        return {
          found: false,
          selector: null,
          availableYears: [...new Set(availableYears)].sort((a, b) => b - a)
        };
      }, targetYear);

      if (!reportSearchResult.found || !reportSearchResult.selector) {
        const yearsText = reportSearchResult.availableYears.length > 0
          ? `Elérhető évek: ${reportSearchResult.availableYears.join(', ')}`
          : 'Nincs elérhető beszámoló';
        console.log(`  ✗ No report found for year ${targetYear}. ${yearsText}`);
        throw new Error(`A ${targetYear}. évre nincs elérhető beszámoló. ${yearsText}`);
      }

      // Kattintsunk a megfelelő linkre
      await page.click(reportSearchResult.selector);
      await page.waitForLoadState('networkidle');
      await this.delay(1000);

      console.log('  → Extracting financial data tables...');
      const financialData = await this.extractFinancialData(page);

      if (!financialData) {
        return null;
      }

      return {
        companyName: companyInfo.companyName || financialData.companyName || originalName || search.value,
        registrationNumber: companyInfo.registrationNumber || financialData.registrationNumber,
        taxNumber: companyInfo.taxNumber || financialData.taxNumber,
        headquarter: companyInfo.headquarter || financialData.headquarter,
        year: targetYear,
        previousYear: financialData.extractedPreviousYear || targetYear - 1,
        targetYear: financialData.extractedTargetYear || targetYear,
        currency: financialData.currency,
        unit: financialData.unit,
        filingDate: financialData.filingDate,
        incomeStatement: financialData.incomeStatement,
        balanceSheet: financialData.balanceSheet,
        extractedAt: new Date().toISOString(),
        sourceURL: page.url()
      };

    } catch (error) {
      console.error('  ! Scraping error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  private async handleTermsPopup(page: Page): Promise<boolean> {
    if (this.termsAccepted) {
      return false;
    }

    try {
      const checkbox = await page.$('#acceptCheck', { strict: true });
      if (checkbox) {
        console.log('  → Accepting terms and conditions...');
        await checkbox.click();
        await this.delay(300);

        const submitButton = await page.$('button:has-text("Tovább")');
        if (submitButton) {
          await submitButton.click();
          await this.delay(1000);
        }

        this.termsAccepted = true;
        return true;
      }
    } catch {
      // Popup not present
    }
    return false;
  }

  private async extractFinancialData(page: Page) {
    return await page.evaluate(() => {
      interface RowData {
        rowNumber: string;
        itemCode: string;
        itemName: string;
        previousYearData: number;
        amendments: number;
        targetYearData: number;
      }

      const parseValue = (text: string): number => {
        if (!text || text.trim() === '' || text.trim() === '—') return 0;
        const cleaned = text.trim().replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      };

      const pageText = document.body.innerText;

      const filingMatch = pageText.match(/Elfogadás időpontja:\s*(\d{4}\.\s*[a-zá-ű]+\s*\d{1,2}\.?)/i);
      const filingDate = filingMatch ? filingMatch[1] : '';

      const currencyMatch = pageText.match(/Pénznem:\s*(HUF|EUR|USD)/);
      const currency = currencyMatch ? currencyMatch[1] : 'HUF';

      const unitMatch = pageText.match(/Pénzegység:\s*(ezer|millió)/);
      const unit = unitMatch ? unitMatch[1] : 'ezer';

      const companyNameMatch = pageText.match(/A cég elnevezése:\s*([^\n\t]+)/);
      const companyName = companyNameMatch ? companyNameMatch[1].trim() : '';

      const regMatch = pageText.match(/Nyilvántartási száma?:\s*(\d{2}-\d{2}-\d{6})/);
      const registrationNumber = regMatch ? regMatch[1] : '';

      const taxMatch = pageText.match(/Adószáma?:\s*([\d-]+)/);
      const taxNumber = taxMatch ? taxMatch[1] : '';

      const hqMatch = pageText.match(/Székhely:\s*([^\n]+)/);
      const headquarter = hqMatch ? hqMatch[1].trim() : '';

      // Évszámok kinyerése a beszámoló időszakból
      // Keressük a mintát: "YYYY. január 01. - YYYY. december 31." vagy hasonló
      // Az oldalon van: "2024. január 01. - 2024. december 31. IDŐSZAKRA VONATKOZÓ"
      let extractedPreviousYear = 0;
      let extractedTargetYear = 0;

      const periodMatch = pageText.match(/(\d{4})\.\s*január\s*\d{1,2}\.\s*-\s*(\d{4})\.\s*december\s*\d{1,2}\./i);
      if (periodMatch) {
        extractedPreviousYear = parseInt(periodMatch[1]) - 1; // Előző év = tárgyév - 1
        extractedTargetYear = parseInt(periodMatch[2]);
      }

      const incomeStatementRows: RowData[] = [];
      const balanceSheetRows: RowData[] = [];

      const tables = document.querySelectorAll('table');

      tables.forEach((table: HTMLTableElement) => {
        const tableText = table.innerText.toUpperCase();

        if (tableText.includes('MÉRLEGE')) {
          const rows = table.querySelectorAll('tbody tr');
          rows.forEach((rowEl) => {
            const row = rowEl as HTMLTableRowElement;
            const cells = row.querySelectorAll('td');

            if (cells.length < 3) return;

            const rowText = row.innerText.toLowerCase();
            if (rowText.includes('sorszám') || rowText.includes('előző üzleti év') ||
                rowText.includes('tételsor elnevezése') || rowText.includes('lezárt üzleti év')) {
              return;
            }

            const rowNumber = cells[0]?.innerText.trim() || '';
            const itemName = cells[1]?.innerText.trim() || '';

            if (!rowNumber.match(/^\d{3}\.?$/)) return;

            let previousYear = 0;
            let amendments = 0;
            let targetYear = 0;

            if (cells.length === 5) {
              previousYear = parseValue(cells[2]?.innerText || '0');
              amendments = parseValue(cells[3]?.innerText || '0');
              targetYear = parseValue(cells[4]?.innerText || '0');
            } else if (cells.length >= 3) {
              previousYear = parseValue(cells[2]?.innerText || '0');
              targetYear = parseValue(cells[cells.length - 1]?.innerText || '0');
            }

            if (rowNumber && itemName) {
              balanceSheetRows.push({
                rowNumber: rowNumber.replace('.', ''),
                itemCode: '',
                itemName,
                previousYearData: previousYear,
                amendments,
                targetYearData: targetYear
              });
            }
          });
        }

        if (tableText.includes('EREDMÉNYKIMUTATÁS')) {
          const rows = table.querySelectorAll('tbody tr');
          rows.forEach((rowEl) => {
            const row = rowEl as HTMLTableRowElement;
            const cells = row.querySelectorAll('td');

            if (cells.length < 3) return;

            const rowText = row.innerText.toLowerCase();
            if (rowText.includes('sorszám') || rowText.includes('előző üzleti év') ||
                rowText.includes('tételsor elnevezése') || rowText.includes('lezárt üzleti év')) {
              return;
            }

            const rowNumber = cells[0]?.innerText.trim() || '';
            const itemName = cells[1]?.innerText.trim() || '';

            if (!rowNumber.match(/^\d{3}\.?$/)) return;

            let previousYear = 0;
            let amendments = 0;
            let targetYear = 0;

            if (cells.length === 5) {
              previousYear = parseValue(cells[2]?.innerText || '0');
              amendments = parseValue(cells[3]?.innerText || '0');
              targetYear = parseValue(cells[4]?.innerText || '0');
            } else if (cells.length >= 3) {
              previousYear = parseValue(cells[2]?.innerText || '0');
              targetYear = parseValue(cells[cells.length - 1]?.innerText || '0');
            }

            if (rowNumber && itemName) {
              incomeStatementRows.push({
                rowNumber: rowNumber.replace('.', ''),
                itemCode: '',
                itemName,
                previousYearData: previousYear,
                amendments,
                targetYearData: targetYear
              });
            }
          });
        }
      });

      return {
        companyName,
        filingDate,
        currency,
        unit,
        registrationNumber,
        taxNumber,
        headquarter,
        extractedPreviousYear,
        extractedTargetYear,
        incomeStatement: { rows: incomeStatementRows },
        balanceSheet: { rows: balanceSheetRows }
      };
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
