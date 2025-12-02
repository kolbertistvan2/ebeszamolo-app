'use client';

import { useState } from 'react';
import { CompanyFinancialReport } from '@/lib/types';
import * as XLSX from 'xlsx';

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
  const [year, setYear] = useState(2024);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompanyFinancialReport | null>(null);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);

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
        body: JSON.stringify({ searchType, searchValue, year }),
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
            } else if (message.type === 'result') {
              if (message.success && message.data) {
                setResult(message.data);
              } else {
                setError(message.error || 'Failed to fetch data');
              }
              setLoading(false);
              // Keep live view visible for 5 more seconds
              setTimeout(() => setLiveViewUrl(null), 5000);
            } else if (message.type === 'error') {
              setError(message.error || 'An error occurred');
              setLoading(false);
              setTimeout(() => setLiveViewUrl(null), 2000);
            }
          } catch {
            console.error('Failed to parse message:', line);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
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

    // Build CSV content
    const lines: string[] = [];

    // Company info
    lines.push('Cégadatok');
    lines.push(`Cégnév,${result.companyName}`);
    lines.push(`Cégjegyzékszám,${result.registrationNumber}`);
    lines.push(`Adószám,${result.taxNumber}`);
    lines.push(`Székhely,${result.headquarter}`);
    lines.push(`Év,${result.year}`);
    lines.push(`Pénznem,${result.currency}`);
    lines.push(`Egység,${result.unit}`);
    lines.push('');

    // Income Statement
    lines.push('Eredménykimutatás');
    lines.push('Megnevezés,Előző év,Tárgyév');
    result.incomeStatement.rows.forEach(row => {
      lines.push(`"${row.itemName}",${row.previousYearData},${row.targetYearData}`);
    });
    lines.push('');

    // Balance Sheet
    lines.push('Mérleg');
    lines.push('Megnevezés,Előző év,Tárgyév');
    result.balanceSheet.rows.forEach(row => {
      lines.push(`"${row.itemName}",${row.previousYearData},${row.targetYearData}`);
    });

    const csvContent = '\uFEFF' + lines.join('\n'); // BOM for Excel UTF-8
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

    // Company info sheet
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

    // Income Statement sheet
    const incomeData = [
      ['Eredménykimutatás'],
      ['Megnevezés', 'Előző év', 'Tárgyév'],
      ...result.incomeStatement.rows.map(row => [row.itemName, row.previousYearData, row.targetYearData])
    ];
    const incomeSheet = XLSX.utils.aoa_to_sheet(incomeData);
    XLSX.utils.book_append_sheet(wb, incomeSheet, 'Eredménykimutatás');

    // Balance Sheet
    const balanceData = [
      ['Mérleg'],
      ['Megnevezés', 'Előző év', 'Tárgyév'],
      ...result.balanceSheet.rows.map(row => [row.itemName, row.previousYearData, row.targetYearData])
    ];
    const balanceSheet = XLSX.utils.aoa_to_sheet(balanceData);
    XLSX.utils.book_append_sheet(wb, balanceSheet, 'Mérleg');

    XLSX.writeFile(wb, getFilename('xlsx'));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            E-Beszamolo Scraper
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Keress magyar cegek penzugyi beszamoloi kozott cegnev vagy adoszam alapjan
          </p>
        </div>

        {/* Search Form */}
        <div className="max-w-2xl mx-auto mb-12">
          <form onSubmit={handleSearch} className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-slate-700">
            {/* Search Type Toggle */}
            <div className="flex gap-4 mb-6">
              <button
                type="button"
                onClick={() => setSearchType('name')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
                  searchType === 'name'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Cegnev
              </button>
              <button
                type="button"
                onClick={() => setSearchType('taxNumber')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
                  searchType === 'taxNumber'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Adoszam
              </button>
            </div>

            {/* Search Input */}
            <div className="mb-6">
              <label className="block text-slate-300 text-sm font-medium mb-2">
                {searchType === 'name' ? 'Cegnev' : 'Adoszam'}
              </label>
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={searchType === 'name' ? 'pl. OTP Bank Nyrt' : 'pl. 12345678'}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {/* Year Select */}
            <div className="mb-6">
              <label className="block text-slate-300 text-sm font-medium mb-2">
                Ev
              </label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {[2024, 2023, 2022, 2021, 2020].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !searchValue}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Kereses folyamatban...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Beszamolo keresese
                </>
              )}
            </button>
          </form>
        </div>

        {/* Live View */}
        {liveViewUrl && (
          <div className="max-w-6xl mx-auto mb-8">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  <h3 className="text-xl font-bold text-white">Live View - Bongeszo</h3>
                </div>
                <span className="text-slate-400 text-sm">A scraping folyamat elonezetben</span>
              </div>
              <div className="relative w-full rounded-xl overflow-hidden border border-slate-600" style={{ paddingTop: '56.25%' }}>
                <iframe
                  src={liveViewUrl}
                  className="absolute top-0 left-0 w-full h-full bg-slate-900"
                  allow="clipboard-read; clipboard-write"
                />
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8">
            <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 text-red-200">
              <p className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="max-w-6xl mx-auto">
            {/* Company Info Card */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-slate-700 mb-8">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-white">{result.companyName}</h2>
                  <p className="text-slate-400">{result.headquarter}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={downloadJSON}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    JSON
                  </button>
                  <button
                    onClick={downloadCSV}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    CSV
                  </button>
                  <button
                    onClick={downloadXLSX}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Excel
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/50 rounded-xl p-4">
                  <p className="text-slate-400 text-sm">Cegjegyzekszam</p>
                  <p className="text-white font-medium">{result.registrationNumber || '-'}</p>
                </div>
                <div className="bg-slate-900/50 rounded-xl p-4">
                  <p className="text-slate-400 text-sm">Adoszam</p>
                  <p className="text-white font-medium">{result.taxNumber || '-'}</p>
                </div>
                <div className="bg-slate-900/50 rounded-xl p-4">
                  <p className="text-slate-400 text-sm">Beszamolo eve</p>
                  <p className="text-white font-medium">{result.year}</p>
                </div>
                <div className="bg-slate-900/50 rounded-xl p-4">
                  <p className="text-slate-400 text-sm">Penznem / Egyseg</p>
                  <p className="text-white font-medium">{result.currency} / {result.unit}</p>
                </div>
              </div>
            </div>

            {/* Financial Tables */}
            <div className="grid md:grid-cols-2 gap-8">
              {/* Income Statement */}
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
                <h3 className="text-xl font-bold text-white mb-4">Eredmenykimutatas</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="text-left py-2">Megnevezes</th>
                        <th className="text-right py-2">Elozo ev</th>
                        <th className="text-right py-2">Targyev</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.incomeStatement.rows.map((row, i) => (
                        <tr key={i} className="border-b border-slate-700/50 text-white">
                          <td className="py-2 pr-4">{row.itemName}</td>
                          <td className="text-right py-2">{row.previousYearData.toLocaleString()}</td>
                          <td className="text-right py-2">{row.targetYearData.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Balance Sheet */}
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
                <h3 className="text-xl font-bold text-white mb-4">Merleg</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="text-left py-2">Megnevezes</th>
                        <th className="text-right py-2">Elozo ev</th>
                        <th className="text-right py-2">Targyev</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.balanceSheet.rows.map((row, i) => (
                        <tr key={i} className="border-b border-slate-700/50 text-white">
                          <td className="py-2 pr-4">{row.itemName}</td>
                          <td className="text-right py-2">{row.previousYearData.toLocaleString()}</td>
                          <td className="text-right py-2">{row.targetYearData.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-16 text-slate-500 text-sm">
          <p>Powered by Kolbert AI</p>
        </div>
      </div>
    </div>
  );
}
