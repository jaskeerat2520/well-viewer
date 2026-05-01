'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

// This file imports mapbox-gl at module top-level, which means it MUST be
// loaded only on the client (mapbox-gl touches `window` during init and
// crashes Next.js's SSR prerender pass). The page-level shell at
// app/states/[state]/page.tsx wraps it in `dynamic({ ssr: false })` so the
// server bundle never executes this module.

type StatusClass = 'orphan' | 'abandoned' | 'plugged' | 'shutin' | 'active' | 'permit' | 'unknown';

const CLASS_COLOR: Record<StatusClass, string> = {
  orphan:    '#ef4444',
  abandoned: '#f97316',
  shutin:    '#eab308',
  permit:    '#a3a3a3',
  plugged:   '#22c55e',
  active:    '#3b82f6',
  unknown:   '#6b7280',
};

const CLASS_LABEL: Record<StatusClass, string> = {
  orphan:    'Orphan / not located',
  abandoned: 'Abandoned',
  shutin:    'Shut-in (idle)',
  permit:    'Permit only',
  plugged:   'Plugged',
  active:    'Active',
  unknown:   'Unknown / other',
};

function classify(status: string | null | undefined): StatusClass {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s.includes('orphan') || s.includes('cannot be located')) return 'orphan';
  if (s.includes('abandoned'))                                  return 'abandoned';
  if (s.includes('plugged'))                                    return 'plugged';
  if (s.includes('shutin') || s.includes('shut-in'))            return 'shutin';
  if (s.includes('active'))                                     return 'active';
  if (s.includes('permit'))                                     return 'permit';
  return 'unknown';
}

interface WellRow {
  api_no:     string;
  state_code: string | null;
  status:     string | null;
  county:     string | null;
  well_name:  string | null;
  operator:   string | null;
}

interface Props {
  stateCodes: string[];     // ['PA'] for single-state, ['OH','PA','WV'] for combined
  title:      string;       // 'Pennsylvania' or 'All states'
  center:     [number, number];
  zoom:       number;
  otherStates: { slug: string; name: string }[];
}

const PAGE_SIZE = 1000;

export default function StateMap({ stateCodes, title, center, zoom, otherStates }: Props) {
  const isCombined = stateCodes.length > 1;
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const featuresRef  = useRef<GeoJSON.Feature[]>([]);

  const [loaded,   setLoaded]   = useState(0);
  const [done,     setDone]     = useState(false);
  const [errMsg,   setErrMsg]   = useState<string | null>(null);
  const [selected, setSelected] = useState<WellRow | null>(null);
  const [byClass,  setByClass]  = useState<Record<StatusClass, number>>({
    orphan: 0, abandoned: 0, plugged: 0, shutin: 0, active: 0, permit: 0, unknown: 0,
  });

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
      setErrMsg('NEXT_PUBLIC_MAPBOX_TOKEN is not set; the map cannot render.');
      return;
    }
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style:     'mapbox://styles/mapbox/dark-v11',
      center,
      zoom,
    });
    m.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = m;

    // Mapbox sizes its WebGL canvas at construction time. When this component
    // is dynamically imported, the surrounding flex layout often hasn't
    // settled yet, so mapbox sees a 0×0 container and renders into an
    // invisible canvas. The fix is two-part:
    //   1) Force a resize once on the next animation frame, after layout has
    //      definitely been computed.
    //   2) Attach a ResizeObserver so any future container size change
    //      (window resize, sidebar reflow, devtools open) propagates.
    requestAnimationFrame(() => {
      if (mapRef.current === m) m.resize();
    });
    const resizeObserver = new ResizeObserver(() => {
      if (mapRef.current === m) m.resize();
    });
    if (mapContainer.current) resizeObserver.observe(mapContainer.current);

    let cancelled = false;

    m.on('load', async () => {
      m.addSource('wells', {
        type:    'geojson',
        data:    { type: 'FeatureCollection', features: [] },
        cluster: false,
      });

      m.addLayer({
        id:     'wells-dot',
        type:   'circle',
        source: 'wells',
        paint: {
          'circle-color': [
            'match', ['get', 'status_class'],
            'orphan',    CLASS_COLOR.orphan,
            'abandoned', CLASS_COLOR.abandoned,
            'shutin',    CLASS_COLOR.shutin,
            'permit',    CLASS_COLOR.permit,
            'plugged',   CLASS_COLOR.plugged,
            'active',    CLASS_COLOR.active,
            CLASS_COLOR.unknown,
          ],
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 1.5, 8, 2.4, 11, 3.6, 14, 5.5,
          ],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.55, 10, 0.85],
          'circle-stroke-width': 0,
        },
      });

      m.on('click', 'wells-dot', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, unknown>;
        setSelected({
          api_no:     String(p.api_no ?? ''),
          state_code: (p.state_code as string) ?? null,
          status:     (p.status     as string) ?? null,
          county:     (p.county     as string) ?? null,
          well_name:  (p.well_name  as string) ?? null,
          operator:   (p.operator   as string) ?? null,
        });
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'wells-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'wells-dot', () => { m.getCanvas().style.cursor = ''; });
      m.on('click', () => setSelected(null));

      // Tally is shared across parallel per-state fetchers. Each batch
      // increments it, then a setState mirror is published from one place
      // so React only re-renders the legend on real updates.
      const tally: Record<StatusClass, number> = {
        orphan: 0, abandoned: 0, plugged: 0, shutin: 0, active: 0, permit: 0, unknown: 0,
      };

      // Every async path here must treat the local `cancelled` flag and the
      // map's removal as a hard gate. React Strict Mode mounts/unmounts the
      // effect twice in dev, so an in-flight Supabase page from the first
      // mount can resolve AFTER its map has been destroyed. Calling
      // m.getSource() on a removed map throws "Cannot read properties of
      // undefined (reading 'getOwnSource')". Same hazard hits production
      // when the user navigates away mid-load.
      const flushSource = () => {
        if (cancelled) return;
        const src = m.getSource('wells') as mapboxgl.GeoJSONSource | undefined;
        if (!src) return;
        src.setData({ type: 'FeatureCollection', features: featuresRef.current });
        setLoaded(featuresRef.current.length);
        setByClass({ ...tally });
      };

      const fetchOneState = async (code: string) => {
        let from = 0;
        while (!cancelled) {
          const { data, error } = await supabase
            .from('wells')
            .select('api_no, lat, lng, status, county, well_name, operator, state_code')
            .eq('state_code', code)
            .not('lat', 'is', null)
            .not('lng', 'is', null)
            .order('api_no')
            .range(from, from + PAGE_SIZE - 1);

          // Post-await checkpoint: the map may have been destroyed while
          // waiting for the response. Bail before touching anything.
          if (cancelled) return;

          if (error) {
            setErrMsg(`Supabase error (${code}): ${error.message}`);
            return;
          }
          if (!data || data.length === 0) return;

          for (const w of data) {
            const cls = classify(w.status);
            tally[cls] += 1;
            featuresRef.current.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [w.lng as number, w.lat as number] },
              properties: {
                api_no:       w.api_no,
                status:       w.status ?? null,
                status_class: cls,
                state_code:   w.state_code ?? code,
                county:       w.county ?? null,
                well_name:    w.well_name ?? null,
                operator:     w.operator ?? null,
              },
            });
          }

          flushSource();

          if (data.length < PAGE_SIZE) return;
          from += PAGE_SIZE;
        }
      };

      // Parallel: all states fetch concurrently; first paint shows whichever
      // state's first page returns first. Wall time = slowest state instead
      // of sum of states.
      await Promise.all(stateCodes.map(fetchOneState));

      if (!cancelled) setDone(true);
    });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      featuresRef.current = [];
    };
    // stateCodes is captured by reference; re-running per-array-instance
    // would tear down and recreate the map every render. Stringify for
    // a stable comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCodes.join(','), center[0], center[1], zoom]);

  return (
    // min-h-0 is the canonical fix for nested flex containers in flex-col
    // parents — without it, the default min-height: auto can prevent a
    // flex-1 child from actually shrinking/growing to its parent's height,
    // which is one common way Mapbox ends up with a 0-height container.
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="relative flex-1 min-h-0">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

        {!done && !errMsg && (
          <div className="absolute top-3 left-3 bg-gray-900/85 border border-gray-700 px-3 py-1.5 rounded text-xs text-gray-200">
            Loading {loaded.toLocaleString()} wells…
          </div>
        )}
        {errMsg && (
          <div className="absolute top-3 left-3 bg-red-900/85 border border-red-700 px-3 py-2 rounded text-xs text-red-100 max-w-md">
            {errMsg}
          </div>
        )}

        <div className="absolute bottom-3 left-3 bg-gray-900/85 border border-gray-700 px-3 py-2 rounded text-[11px] space-y-1">
          <div className="font-semibold text-gray-200 mb-1">Status</div>
          {(Object.keys(CLASS_LABEL) as StatusClass[]).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: CLASS_COLOR[k] }} />
              <span className="text-gray-300">{CLASS_LABEL[k]}</span>
              <span className="text-gray-500 font-mono ml-auto">{byClass[k].toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <aside className="w-[320px] border-l border-gray-800 bg-gray-900 overflow-auto">
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Wells-only PoC</div>
          <div className="text-sm text-gray-300 mt-1">
            {isCombined ? (
              <>
                Showing wells across {stateCodes.length} states (
                {stateCodes.join(', ')}). Markers are coloured by status. Ohio&apos;s
                full risk scoring (water, population, vegetation, terrain, emissions) is
                visible on the dedicated{' '}
                <Link href="/" className="text-blue-400 hover:underline">Ohio map</Link>.
              </>
            ) : (
              <>
                {title} wells are ingested with{' '}
                <code className="bg-gray-800 px-1 rounded text-xs">state_code = {stateCodes[0]}</code>.
                Risk scoring (water, population, vegetation, terrain, emissions) is not yet
                extended to {title}; markers are coloured by source-of-truth status from the
                {stateCodes[0] === 'PA' ? ' PA DEP' : stateCodes[0] === 'WV' ? ' WV TAGIS' : ' state'}{' '}
                feed.
              </>
            )}
          </div>
        </div>

        {selected ? (
          <div className="px-4 py-3 border-b border-gray-800">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Selected well</div>
            <div className="font-medium text-gray-200">{selected.well_name ?? <em className="text-gray-500">(unnamed)</em>}</div>
            <div className="font-mono text-[11px] text-gray-500 mt-0.5">{selected.api_no}</div>
            <dl className="mt-3 text-xs space-y-1.5">
              {isCombined && <Field label="State" value={selected.state_code} />}
              <Field label="Status"   value={selected.status} />
              <Field label="County"   value={selected.county} />
              <Field label="Operator" value={selected.operator} />
            </dl>
            <button
              onClick={() => setSelected(null)}
              className="mt-3 text-[11px] text-gray-500 hover:text-gray-300"
            >
              Clear selection
            </button>
          </div>
        ) : (
          <div className="px-4 py-3 border-b border-gray-800 text-xs text-gray-500">
            Click a well on the map to inspect.
          </div>
        )}

        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Other states</div>
          <div className="flex flex-wrap gap-1.5">
            {otherStates.map((s) => (
              <Link
                key={s.slug}
                href={`/states/${s.slug}`}
                className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex">
      <dt className="w-20 shrink-0 text-gray-500">{label}</dt>
      <dd className="flex-1 text-gray-200 break-words">{value ?? <em className="text-gray-600">—</em>}</dd>
    </div>
  );
}
