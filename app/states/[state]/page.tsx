'use client';

import { use } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import SiteHeader from '@/components/SiteHeader';

// `StateMap` imports mapbox-gl at module top-level, and mapbox-gl crashes
// during Next.js's SSR prerender pass because it touches `window` at init.
// `dynamic({ ssr: false })` is the stronger guarantee that this module
// never runs on the server — `'use client'` alone is NOT enough, since
// client components are still server-rendered for hydration HTML.
const StateMap = dynamic(() => import('./StateMap'), { ssr: false });

const STATES = {
  oh: { code: 'OH', name: 'Ohio',          center: [-82.8, 40.4] as [number, number], zoom: 6.8 },
  pa: { code: 'PA', name: 'Pennsylvania',  center: [-77.6, 40.9] as [number, number], zoom: 6.8 },
  wv: { code: 'WV', name: 'West Virginia', center: [-80.5, 38.6] as [number, number], zoom: 6.8 },
};

type Slug = keyof typeof STATES;

export default function StatePage({ params }: { params: Promise<{ state: string }> }) {
  const { state: rawSlug } = use(params);
  const slug = rawSlug.toLowerCase() as Slug;
  const stateInfo = STATES[slug];

  if (!stateInfo) {
    return (
      <div className="flex flex-col h-screen bg-gray-950 text-white">
        <SiteHeader title="Unknown state" />
        <div className="px-6 py-10 text-sm text-gray-400">
          State <span className="font-mono text-white">{rawSlug}</span> is not currently supported.
          Recognised slugs:{' '}
          <Link href="/states/oh" className="text-blue-400 hover:underline">oh</Link>,{' '}
          <Link href="/states/pa" className="text-blue-400 hover:underline">pa</Link>,{' '}
          <Link href="/states/wv" className="text-blue-400 hover:underline">wv</Link>.
        </div>
      </div>
    );
  }

  if (stateInfo.code === 'OH') {
    return (
      <div className="flex flex-col h-screen bg-gray-950 text-white">
        <SiteHeader title="Ohio" subtitle="Full-feature map at /" />
        <div className="px-6 py-10 max-w-2xl text-sm text-gray-300 space-y-3">
          <p>
            Ohio is the project&apos;s home state — the full risk-scored map (water proximity,
            population exposure, vegetation, terrain, methane + thermal emissions, parcels,
            schools, hospitals, plumes) lives at the project root.
          </p>
          <p>
            <Link href="/" className="text-blue-400 hover:underline">→ Open Ohio map</Link>
          </p>
          <p className="text-xs text-gray-500 pt-4 border-t border-gray-800">
            This <code>/states/[state]</code> route was added for the multi-state expansion PoC.
            See <Link href="/states/pa" className="text-blue-400 hover:underline">/states/pa</Link>{' '}
            and <Link href="/states/wv" className="text-blue-400 hover:underline">/states/wv</Link>{' '}
            for the wells-only expansion to Pennsylvania and West Virginia.
          </p>
        </div>
      </div>
    );
  }

  const otherStates = (Object.keys(STATES) as Slug[])
    .filter((s) => s !== slug)
    .map((s) => ({ slug: s, name: STATES[s].name }));

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <SiteHeader title={stateInfo.name} subtitle={`State code ${stateInfo.code}`} />
      <StateMap
        stateCodes={[stateInfo.code]}
        title={stateInfo.name}
        center={stateInfo.center}
        zoom={stateInfo.zoom}
        otherStates={[...otherStates, { slug: 'all', name: 'All states' }]}
      />
    </div>
  );
}
