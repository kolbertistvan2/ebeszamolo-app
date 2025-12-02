'use client';

import { useState, useRef, useEffect } from 'react';
import { CompanyFinancialReport } from '@/lib/types';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Download, Building2, FileSpreadsheet, FileJson, Loader2 } from 'lucide-react';

// Helper függvény a százalékos változás számításához
function calculateChangePercent(previousYear: number, targetYear: number): { value: number | null; display: string; colorClass: string } {
  if (previousYear === 0 && targetYear === 0) {
    return { value: null, display: '-', colorClass: 'text-slate-400' };
  }
  if (previousYear === 0) {
    return { value: null, display: 'új', colorClass: 'text-blue-500' };
  }
  const change = ((targetYear - previousYear) / Math.abs(previousYear)) * 100;
  const display = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  const colorClass = change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-slate-400';
  return { value: change, display, colorClass };
}

interface StreamMessage {
  type: 'liveView' | 'result' | 'error';
  liveViewUrl?: string;
  sessionId?: string;
  success?: boolean;
  data?: CompanyFinancialReport;
  error?: string;
}

export default function Home() {
  const [searchType, setSearchType] = useState<'name' | 'taxNumber'>('name');
  const [searchValue, setSearchValue] = useState('');
  const [year, setYear] = useState('2024');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompanyFinancialReport | null>(null);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [sideLayout, setSideLayout] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Automatikus görgetés az eredményekhez amikor megérkeznek
  useEffect(() => {
    if (result && resultsRef.current) {
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [result]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setLiveViewUrl(null);

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchType, searchValue, year: Number(year) }),
      });

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const message: StreamMessage = JSON.parse(line);

            if (message.type === 'liveView' && message.liveViewUrl) {
              setLiveViewUrl(message.liveViewUrl);
              setSideLayout(true);
            } else if (message.type === 'result') {
              if (message.success && message.data) {
                setResult(message.data);
              } else {
                setError(message.error || 'Nem sikerült lekérni az adatokat');
              }
              setLoading(false);
              // Töröljük a live view URL-t hogy ne legyen WebSocket disconnect görgetés
              setLiveViewUrl(null);
            } else if (message.type === 'error') {
              setError(message.error || 'Hiba történt');
              setLoading(false);
              // A live view marad látható amíg új keresést nem indítunk
            }
          } catch {
            console.error('Failed to parse message:', line);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hiba történt');
      setLoading(false);
      setLiveViewUrl(null);
    }
  };

  const getFilename = (ext: string) => {
    if (!result) return '';
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
    const random = Math.random().toString(36).substring(2, 8);
    const sanitizedName = result.companyName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
    return `${sanitizedName}_${timestamp}_${random}.${ext}`;
  };

  const downloadJSON = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFilename('json');
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    if (!result) return;

    const lines: string[] = [];

    lines.push('Cégadatok');
    lines.push(`Cégnév,${result.companyName}`);
    lines.push(`Cégjegyzékszám,${result.registrationNumber}`);
    lines.push(`Adószám,${result.taxNumber}`);
    lines.push(`Székhely,${result.headquarter}`);
    lines.push(`Év,${result.year}`);
    lines.push(`Pénznem,${result.currency}`);
    lines.push(`Egység,${result.unit}`);
    lines.push('');

    lines.push('Eredménykimutatás (ezer Ft)');
    lines.push(`Megnevezés,${result.previousYear},${result.targetYear},Változás (%)`);
    result.incomeStatement.rows.forEach(row => {
      const change = calculateChangePercent(row.previousYearData, row.targetYearData);
      lines.push(`"${row.itemName}",${row.previousYearData},${row.targetYearData},"${change.display}"`);
    });
    lines.push('');

    lines.push('Mérleg (ezer Ft)');
    lines.push(`Megnevezés,${result.previousYear},${result.targetYear},Változás (%)`);
    result.balanceSheet.rows.forEach(row => {
      const change = calculateChangePercent(row.previousYearData, row.targetYearData);
      lines.push(`"${row.itemName}",${row.previousYearData},${row.targetYearData},"${change.display}"`);
    });

    const csvContent = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFilename('csv');
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadXLSX = () => {
    if (!result) return;

    const wb = XLSX.utils.book_new();

    const infoData = [
      ['Cégadatok'],
      ['Cégnév', result.companyName],
      ['Cégjegyzékszám', result.registrationNumber],
      ['Adószám', result.taxNumber],
      ['Székhely', result.headquarter],
      ['Év', result.year],
      ['Pénznem', result.currency],
      ['Egység', result.unit],
    ];
    const infoSheet = XLSX.utils.aoa_to_sheet(infoData);
    XLSX.utils.book_append_sheet(wb, infoSheet, 'Cégadatok');

    const incomeData = [
      ['Eredménykimutatás (ezer Ft)'],
      ['Megnevezés', result.previousYear, result.targetYear, 'Változás (%)'],
      ...result.incomeStatement.rows.map(row => {
        const change = calculateChangePercent(row.previousYearData, row.targetYearData);
        return [row.itemName, row.previousYearData, row.targetYearData, change.display];
      })
    ];
    const incomeSheet = XLSX.utils.aoa_to_sheet(incomeData);
    XLSX.utils.book_append_sheet(wb, incomeSheet, 'Eredménykimutatás');

    const balanceData = [
      ['Mérleg (ezer Ft)'],
      ['Megnevezés', result.previousYear, result.targetYear, 'Változás (%)'],
      ...result.balanceSheet.rows.map(row => {
        const change = calculateChangePercent(row.previousYearData, row.targetYearData);
        return [row.itemName, row.previousYearData, row.targetYearData, change.display];
      })
    ];
    const balanceSheet = XLSX.utils.aoa_to_sheet(balanceData);
    XLSX.utils.book_append_sheet(wb, balanceSheet, 'Mérleg');

    XLSX.writeFile(wb, getFilename('xlsx'));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-2">
            Kolbert AI Céginformáció
          </h1>
          <p className="text-slate-600">
            Keress magyar cégek pénzügyi beszámolói között cégnév vagy adószám alapján
          </p>
        </div>

        {/* Main Content - Side by Side on desktop, stacked on mobile */}
        <div className={`flex gap-6 ${sideLayout ? 'flex-col md:flex-row' : 'flex-col items-center'}`}>
          {/* Search Form */}
          <Card className={`${sideLayout ? 'w-full md:w-80 md:shrink-0' : 'w-full max-w-lg'} transition-all duration-300`}>
            <CardHeader className={sideLayout ? 'py-1 px-4' : 'pt-4 pb-2 px-4'}>
              <CardTitle className="flex items-center gap-2 text-slate-800 text-base">
                <Building2 className="h-4 w-4" />
                Keresés
              </CardTitle>
              {!sideLayout && (
                <CardDescription className="mt-0.5">
                  Add meg a cég nevét vagy adószámát
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className={sideLayout ? 'pt-0 px-4' : 'pt-2 px-4'}>
              <form onSubmit={handleSearch} className="space-y-4">
                {/* Search Type Toggle */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={searchType === 'name' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setSearchType('name')}
                  >
                    Cégnév
                  </Button>
                  <Button
                    type="button"
                    variant={searchType === 'taxNumber' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setSearchType('taxNumber')}
                  >
                    Adószám
                  </Button>
                </div>

                {/* Search Input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    {searchType === 'name' ? 'Cégnév' : 'Adószám'}
                  </label>
                  <Input
                    type="text"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder={searchType === 'name' ? 'Cégnév' : 'Adószám'}
                    required
                  />
                </div>

                {/* Year Select */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Év</label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Válassz évet" />
                    </SelectTrigger>
                    <SelectContent>
                      {[2024, 2023, 2022, 2021, 2020].map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={loading || !searchValue}
                  className="w-full"
                  size="lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Keresés folyamatban...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      Beszámoló keresése
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Live View - Side by side with search */}
          {sideLayout && (
            <Card className="flex-1 min-w-0">
              <CardHeader className="pt-2 pb-1 px-4">
                <CardTitle className="flex items-center gap-2 text-slate-800 text-base">
                  {liveViewUrl ? (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                    </span>
                  ) : (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-400"></span>
                    </span>
                  )}
                  {liveViewUrl ? 'Élő nézet' : 'Befejezve'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-1 px-4">
                <div
                  className="relative w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
                  style={{ paddingTop: '56.25%' }}
                >
                  {liveViewUrl ? (
                    <iframe
                      src={liveViewUrl}
                      className="absolute top-0 left-0 w-full h-full bg-white"
                      style={{ pointerEvents: loading ? 'auto' : 'none' }}
                      allow="clipboard-read; clipboard-write"
                      tabIndex={-1}
                    />
                  ) : (
                    <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center text-slate-400">
                      A böngésző session lezárult
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="max-w-lg mx-auto mt-6">
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <p className="text-red-700 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Results */}
        {result && (
          <div ref={resultsRef} className="mt-8 space-y-6">
            {/* Company Info Card */}
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <CardTitle className="text-xl sm:text-2xl text-slate-800">{result.companyName}</CardTitle>
                    <CardDescription className="text-sm sm:text-base">{result.headquarter}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={downloadJSON} variant="outline" size="sm">
                      <FileJson className="h-4 w-4" />
                      <span className="hidden sm:inline">JSON</span>
                    </Button>
                    <Button onClick={downloadCSV} variant="outline" size="sm">
                      <Download className="h-4 w-4" />
                      <span className="hidden sm:inline">CSV</span>
                    </Button>
                    <Button onClick={downloadXLSX} variant="outline" size="sm">
                      <FileSpreadsheet className="h-4 w-4" />
                      <span className="hidden sm:inline">Excel</span>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="bg-slate-50 rounded-lg p-3 sm:p-4 border border-slate-100">
                    <p className="text-slate-500 text-xs sm:text-sm">Cégjegyzékszám</p>
                    <p className="text-slate-800 font-medium text-sm sm:text-base break-all">{result.registrationNumber || '-'}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 sm:p-4 border border-slate-100">
                    <p className="text-slate-500 text-xs sm:text-sm">Adószám</p>
                    <p className="text-slate-800 font-medium text-sm sm:text-base break-all">{result.taxNumber || '-'}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 sm:p-4 border border-slate-100">
                    <p className="text-slate-500 text-xs sm:text-sm">Beszámoló éve</p>
                    <p className="text-slate-800 font-medium text-sm sm:text-base">{result.year}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 sm:p-4 border border-slate-100">
                    <p className="text-slate-500 text-xs sm:text-sm">Pénznem / Egység</p>
                    <p className="text-slate-800 font-medium text-sm sm:text-base">{result.currency} / {result.unit}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Financial Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* Income Statement */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base sm:text-lg text-slate-800">Eredménykimutatás (ezer Ft)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="text-slate-500 border-b-2 border-slate-300">
                          <th className="text-left py-2 font-medium">Megnevezés</th>
                          <th className="text-right py-2 pl-2 font-medium">{result.previousYear}</th>
                          <th className="text-right py-2 pl-2 font-medium">{result.targetYear}</th>
                          <th className="text-right py-2 pl-2 font-medium">Változás</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.incomeStatement.rows.map((row, i) => {
                          const change = calculateChangePercent(row.previousYearData, row.targetYearData);
                          return (
                            <tr key={i} className="border-b border-slate-100 text-slate-700">
                              <td className="py-2 pr-1">{row.itemName}</td>
                              <td className="text-right py-2 pl-2 tabular-nums text-slate-500 whitespace-nowrap">{row.previousYearData.toLocaleString()}</td>
                              <td className="text-right py-2 pl-2 tabular-nums font-semibold whitespace-nowrap">{row.targetYearData.toLocaleString()}</td>
                              <td className={`text-right py-2 pl-2 tabular-nums whitespace-nowrap ${change.colorClass}`}>{change.display}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Balance Sheet */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base sm:text-lg text-slate-800">Mérleg (ezer Ft)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="text-slate-500 border-b-2 border-slate-300">
                          <th className="text-left py-2 font-medium">Megnevezés</th>
                          <th className="text-right py-2 pl-2 font-medium">{result.previousYear}</th>
                          <th className="text-right py-2 pl-2 font-medium">{result.targetYear}</th>
                          <th className="text-right py-2 pl-2 font-medium">Változás</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.balanceSheet.rows.map((row, i) => {
                          const change = calculateChangePercent(row.previousYearData, row.targetYearData);
                          return (
                            <tr key={i} className="border-b border-slate-100 text-slate-700">
                              <td className="py-2 pr-1">{row.itemName}</td>
                              <td className="text-right py-2 pl-2 tabular-nums text-slate-500 whitespace-nowrap">{row.previousYearData.toLocaleString()}</td>
                              <td className="text-right py-2 pl-2 tabular-nums font-semibold whitespace-nowrap">{row.targetYearData.toLocaleString()}</td>
                              <td className={`text-right py-2 pl-2 tabular-nums whitespace-nowrap ${change.colorClass}`}>{change.display}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col items-center mt-12 gap-2">
          <img src="/kolbert-ai-logo.svg" alt="Kolbert AI" className="h-6" />
          <p className="text-slate-400 text-sm">Beta v0.1</p>
        </div>
      </div>
    </div>
  );
}
