# Kolbert AI Céginformáció - Claude Context

## Project Overview

Hungarian company financial report scraper web application. Extracts financial statements (Income Statement, Balance Sheet) from the official Hungarian government registry (e-beszamolo.im.gov.hu).

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **UI**: shadcn/ui components, Tailwind CSS 4
- **Browser Automation**: Browserbase cloud browser with Playwright
- **Language**: TypeScript

## Key Files

### Frontend
- `src/app/page.tsx` - Main page component with search form, live view, and results display
- `src/app/layout.tsx` - Root layout with metadata
- `src/app/globals.css` - Tailwind theme configuration (light theme, slate colors)
- `src/components/ui/` - shadcn/ui components (Button, Card, Input, Select)

### Backend
- `src/app/api/scrape/route.ts` - Streaming API endpoint for scraping
- `src/lib/scraper.ts` - EBeszamoloScraper class with Browserbase integration
- `src/lib/types.ts` - TypeScript interfaces (CompanyFinancialReport, etc.)

### Assets
- `public/kolbert-ai-logo.svg` - Kolbert AI logo for footer

## Architecture

1. User submits search (company name or tax number + year)
2. API creates Browserbase cloud browser session
3. Live view URL streamed to frontend immediately
4. Scraper navigates e-beszamolo.im.gov.hu, finds company, extracts data
5. Results streamed back, iframe removed to prevent WebSocket scroll issues
6. User can export as JSON, CSV, or Excel

## State Management

- `liveViewUrl` - Current Browserbase live view URL (null after completion)
- `sideLayout` - Persists side-by-side layout after live view ends
- `result` - CompanyFinancialReport data
- `loading`, `error` - Request state

## Key Features

- Year-specific report selection (matches "YYYY. december 31." pattern)
- Shows available years when selected year not found
- Exports show concrete years (2022, 2023) not "Előző év"
- Live browser view during scraping
- "Befejezve" state when session ends (prevents scroll jump)

## Environment Variables

Required in `.env.local`:
```
BROWSERBASE_API_KEY=your_api_key
BROWSERBASE_PROJECT_ID=your_project_id
```

## Commands

```bash
npm run dev    # Development server
npm run build  # Production build
npm run start  # Start production server
```

## Notes

- Viewport: 1280x720 (HD)
- 5-second delay before browser close for live view visibility
- Results auto-saved to `results/` folder on server
- Hungarian UI text throughout
