export interface FinancialRow {
  rowNumber: string;
  itemCode: string;
  itemName: string;
  previousYearData: number;
  amendments: number;
  targetYearData: number;
}

export interface FinancialStatement {
  rows: FinancialRow[];
}

export interface CompanyFinancialReport {
  companyName: string;
  registrationNumber: string;
  taxNumber: string;
  headquarter: string;
  year: number;
  previousYear: number;  // Előző üzleti év (pl. 2022)
  targetYear: number;    // Tárgy üzleti év (pl. 2023)
  currency: string;
  unit: string;
  filingDate: string;
  incomeStatement: FinancialStatement;
  balanceSheet: FinancialStatement;
  extractedAt: string;
  sourceURL: string;
}

export interface ScrapeRequest {
  searchType: 'name' | 'taxNumber';
  searchValue: string;
  year?: number;
}

export interface ScrapeResponse {
  success: boolean;
  data?: CompanyFinancialReport;
  error?: string;
  liveViewUrl?: string;
  sessionId?: string;
}

export interface LiveViewResponse {
  liveViewUrl: string;
  sessionId: string;
}
