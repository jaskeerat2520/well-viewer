'use client';

import dynamic from 'next/dynamic';
import SiteHeader from '@/components/SiteHeader';

// Reuse the same StateMap component as /states/[state] — it already accepts
// a stateCodes array and runs parallel per-state fetches when given more
// than one. mapbox-gl must stay behind the dynamic({ ssr: false }) boundary
// for the same reason as the per-state map.
const StateMap = dynamic(() => import('../[state]/StateMap'), { ssr: false });

// Centred between OH/PA/WV; zoom 6 fits the tristate area on a typical
// laptop. Mapbox autozooms via fitBounds would be nicer but requires the
// whole feature set to be loaded first, which defeats the progressive UX.
const TRISTATE_CENTER: [number, number] = [-80.5, 39.8];
const TRISTATE_ZOOM = 6;

export default function AllStatesPage() {
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <SiteHeader title="All states" subtitle="OH + PA + WV combined" />
      <StateMap
        stateCodes={['OH', 'PA', 'WV']}
        title="All states"
        center={TRISTATE_CENTER}
        zoom={TRISTATE_ZOOM}
        otherStates={[
          { slug: 'oh', name: 'Ohio' },
          { slug: 'pa', name: 'Pennsylvania' },
          { slug: 'wv', name: 'West Virginia' },
        ]}
      />
    </div>
  );
}
