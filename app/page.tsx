'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WellDetail, Priority, CountySummary, NearYouResult } from '@/lib/types';
import WellSidebar from '@/components/WellSidebar';
import SiteHeader from '@/components/SiteHeader';

// Disable SSR for the map — Mapbox GL requires the browser DOM
const WellMap = dynamic(() => import('@/components/WellMap'), { ssr: false });

function HomeInner() {
  const searchParams = useSearchParams();

  const [selectedWell, setSelectedWell] = useState<WellDetail | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<CountySummary | null>(null);
  const [filters, setFilters] = useState<Priority[]>(['critical', 'high', 'medium', 'low']);
  const [nearYouResult, setNearYouResult] = useState<NearYouResult | null>(null);
  const [centerOn, setCenterOn] = useState<{ lat: number; lng: number } | null>(null);

  // Deep-link from "View on Map" buttons (well detail page + county map popup).
  // Reads ?lat=&lng= and centers the map on that point. We only honor this on
  // first mount so the user can pan away freely afterward.
  useEffect(() => {
    const lat = parseFloat(searchParams?.get('lat') ?? '');
    const lng = parseFloat(searchParams?.get('lng') ?? '');
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setCenterOn({ lat, lng });
    }
    // intentionally empty deps — only fires on mount with the initial URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <SiteHeader leftExtra={<span>Click a well or county to inspect</span>} />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <WellMap
          filters={filters}
          onFilterChange={toggleFilter}
          onSelectWell={handleSelectWell}
          onSelectCounty={handleSelectCounty}
          selectedCounty={selectedCounty}
          onNearYouResult={setNearYouResult}
          centerOn={centerOn}
        />
        <WellSidebar
          well={selectedWell}
          selectedCounty={selectedCounty}
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

export default function Home() {
  // useSearchParams needs a Suspense boundary in Next 15+.
  return (
    <Suspense fallback={<div className="h-screen bg-gray-950" />}>
      <HomeInner />
    </Suspense>
  );
}
