# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] - 2025-12-02

### Added
- **Year Selection**: Select specific fiscal year (2020-2024) for report retrieval
- **Available Years Error**: When selected year not available, shows list of available years
- **Kolbert AI Logo**: Footer now displays Kolbert AI logo with version number
- **Beta Badge**: "Beta v0.1" indicator in footer

### Changed
- **UI Overhaul**: Complete redesign with shadcn/ui components
  - Light theme with slate color palette
  - Side-by-side layout for search and live view
  - Compact card headers with reduced padding
  - Responsive mobile-first design
- **Live View Behavior**:
  - Session card stays visible after completion with "Befejezve" state
  - Prevents scroll jump on WebSocket disconnect
  - Grey placeholder when session ends
- **Export Headers**: CSV and Excel now show concrete year numbers (2022, 2023) instead of "Előző év" / "Tárgyév"
- **Meta Tags**: Updated title and description to "Kolbert AI Céginformáció"
- **Error Messages**: Hungarian error message for unavailable years with available years list

### Fixed
- WebSocket disconnect scroll issue resolved by removing iframe on completion
- Year selection now correctly matches report period dates

## [2.0.0] - 2025-12-02

### Added
- **Browserbase Cloud Browser Integration**: Replaced local Playwright browser with Browserbase cloud browser for better scalability and Vercel deployment compatibility
- **Live View**: Real-time browser view during scraping process using Browserbase debugger
- **Modern Web UI**: Complete Next.js 16 frontend with Tailwind CSS
  - Company name and tax number search
  - Year selector (2020-2024)
  - Live scraping progress view
  - Results display with company info and financial tables
- **Multiple Export Formats**:
  - JSON download
  - CSV download (UTF-8 with BOM for Excel compatibility)
  - Excel (.xlsx) download with multiple sheets (Cégadatok, Eredménykimutatás, Mérleg)
- **Automatic Result Saving**: Server-side automatic saving of results to `results/` folder
- **Streaming API**: Real-time updates during scraping via streaming response

### Changed
- **Architecture**: Migrated from CLI-only tool to full-stack web application
- **Browser Engine**: Switched from local Playwright to Browserbase cloud browser
- **Company Name Display**: Now shows official company name from registry instead of search term
- **File Naming**: New format `CégNév_YYYYMMDD_HHMMSS_random.ext`

### Technical Details
- Next.js 16 with App Router
- Browserbase SDK for cloud browser management
- Viewport: 1280x720 (HD)
- 5-second delay before browser close for live view visibility
- Budapest timezone for timestamps

## [1.0.0] - 2025-12-02

### Initial Release
- CLI-based scraper for e-beszamolo.im.gov.hu
- Local Playwright browser automation
- Company search by name or tax number
- Financial data extraction (Income Statement, Balance Sheet)
- JSON export
- Batch processing support
