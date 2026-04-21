'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import Link from 'next/link';
import { WellDetail, Priority, CountySummary, NearYouResult } from '@/lib/types';
import WellSidebar from '@/components/WellSidebar';

// Disable SSR for the map — Mapbox GL requires the browser DOM
const WellMap = dynamic(() => import('@/components/WellMap'), { ssr: false });

export default function Home() {
  const [selectedWell, setSelectedWell] = useState<WellDetail | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<CountySummary | null>(null);
  const [filters, setFilters] = useState<Priority[]>(['critical', 'high', 'medium', 'low']);
  const [nearYouResult, setNearYouResult] = useState<NearYouResult | null>(null);
  const [centerOn, setCenterOn] = useState<{ lat: number; lng: number } | null>(null);

  function toggleFilter(priority: Priority) {
    setFilters(prev =>
      prev.includes(priority) ? prev.filter(p => p !== priority) : [...prev, priority]
    );
  }

  function handleSelectWell(well: WellDetail | null) {
    setSelectedWell(well);
    if (well) {
      setSelectedCounty(null);
      if (well.well?.lat && well.well?.lng) {
        setCenterOn({ lat: well.well.lat, lng: well.well.lng });
      }
    }
  }

  function handleSelectCounty(county: CountySummary | null) {
    setSelectedCounty(county);
    if (county) setSelectedWell(null);
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight">Ohio Well Risk Viewer</h1>
          <span className="text-xs text-gray-500">Click a well or county to inspect</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/about"    className="text-xs text-gray-400 hover:text-white transition-colors">About</Link>
          <Link href="/table"    className="text-xs text-gray-400 hover:text-white transition-colors">Table</Link>
          <Link href="/counties" className="text-xs text-gray-400 hover:text-white transition-colors">Counties</Link>
          <Link href="/facts"    className="text-xs text-gray-400 hover:text-white transition-colors">Facts</Link>
          <Link href="/impact"   className="text-xs text-gray-400 hover:text-white transition-colors">Impact</Link>
          <Link href="/emissions" className="text-xs text-gray-400 hover:text-white transition-colors">Emissions →</Link>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <WellMap
          filters={filters}
          onFilterChange={toggleFilter}
          onSelectWell={handleSelectWell}
          onSelectCounty={handleSelectCounty}
          onNearYouResult={setNearYouResult}
          centerOn={centerOn}
        />
        <WellSidebar
          well={selectedWell}
          selectedCounty={selectedCounty}
          filters={filters}
          onFilterChange={toggleFilter}
          onClose={() => setSelectedWell(null)}
          onCloseCounty={() => setSelectedCounty(null)}
          nearYouResult={nearYouResult}
          onClearNearYou={() => setNearYouResult(null)}
          onSelectWell={handleSelectWell}
        />
      </div>
    </div>
  );
}
