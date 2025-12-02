import { NextRequest } from 'next/server';
import { EBeszamoloScraper } from '@/lib/scraper';
import { ScrapeRequest, CompanyFinancialReport } from '@/lib/types';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const maxDuration = 60; // Vercel timeout

// Helper to save results to file
async function saveResult(report: CompanyFinancialReport) {
  try {
    const resultsDir = path.join(process.cwd(), 'results');
    await mkdir(resultsDir, { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
    const random = Math.random().toString(36).substring(2, 8);

    const sanitizedName = report.companyName
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 100);

    const filename = `${sanitizedName}_${timestamp}_${random}.json`;
    const filepath = path.join(resultsDir, filename);

    await writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`✓ Saved result to: ${filepath}`);
  } catch (error) {
    console.error('Failed to save result:', error);
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body: ScrapeRequest = await request.json();
        const { searchType, searchValue, year = 2024 } = body;

        if (!searchValue || !searchType) {
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'error',
            error: 'Missing required fields: searchType and searchValue'
          }) + '\n'));
          controller.close();
          return;
        }

        const scraper = new EBeszamoloScraper();

        try {
          // Initialize and get live view URL immediately
          const { sessionId, liveViewUrl } = await scraper.initialize();

          // Send live view URL first
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'liveView',
            liveViewUrl,
            sessionId
          }) + '\n'));

          // Perform scraping
          let report;
          if (searchType === 'taxNumber') {
            report = await scraper.scrapeByTaxNumber(searchValue, year);
          } else {
            report = await scraper.scrapeSingleCompany(searchValue, year);
          }

          if (report) {
            // Save result to file
            await saveResult(report);

            controller.enqueue(encoder.encode(JSON.stringify({
              type: 'result',
              success: true,
              data: report
            }) + '\n'));
          } else {
            controller.enqueue(encoder.encode(JSON.stringify({
              type: 'result',
              success: false,
              error: 'No data found for the given search criteria'
            }) + '\n'));
          }

          // Keep browser open for a few seconds so user can see the final state
          await new Promise(resolve => setTimeout(resolve, 5000));
        } finally {
          await scraper.close();
        }
      } catch (error) {
        console.error('API Error:', error);
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        }) + '\n'));
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}
