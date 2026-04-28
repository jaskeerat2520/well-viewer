'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';
import { Priority, PRIORITY_COLOR, ADMIN_STATUS_LABEL, AdminStatus } from '@/lib/types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

// Layer order: later = rendered on top. Critical points must not be hidden
// behind medium/low clusters, so draw the high-priority tiers last.
const PRIORITY_DRAW_ORDER: Priority[] = ['low', 'medium', 'high', 'critical'];

const PRIORITY_RADIUS: Record<Priority, number> = {
  critical: 5,
  high:     4,
  medium:   3,
  low:      2.5,
};

// Opacity tuned for readability over a busy aerial basemap — low-priority
// wells still need to be faintly distinguishable from imagery clutter.
const PRIORITY_OPACITY: Record<Priority, number> = {
  critical: 1.0,
  high:     0.95,
  medium:   0.8,
  low:      0.6,
};

interface CountyMapWell {
  api_no: string;
  lat: number;
  lng: number;
  priority: Priority | null;
  composite_risk_score: number | null;
  operator: string | null;
  status: string | null;
  well_name: string | null;
  admin_status: string | null;
}

export default function CountyMap({ county }: { county: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded,  setMapLoaded] = useState(false);
  const [wells,      setWells]     = useState<CountyMapWell[]>([]);
  const [loadingMsg, setLoadingMsg] = useState<string>('Loading wells…');

  // Load every scored well in this county (page 1000 at a time).
  useEffect(() => {
    let cancelled = false;
    async function loadWells() {
      const all: CountyMapWell[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('well_map_view')
          .select('api_no, lat, lng, priority, composite_risk_score, operator, status, well_name, admin_status')
          .eq('county', county)
          .not('lat', 'is', null)
          .not('lng', 'is', null)
          .range(from, from + PAGE - 1);
        if (cancelled) return;
        if (error) { setLoadingMsg('Failed to load wells'); return; }
        if (!data || data.length === 0) break;
        all.push(...(data as unknown as CountyMapWell[]));
        setLoadingMsg(`Loading wells… ${all.length.toLocaleString()}`);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (cancelled) return;
      setWells(all);
      setLoadingMsg('');
    }
    loadWells();
    return () => { cancelled = true; };
  }, [county]);

  // Initialize the Mapbox instance once. Uses a blank base style so the only
  // imagery shown is Bing Vexcel — served via the /api/bing-tiles proxy that
  // quadkey-maps to Microsoft's virtualearth.net tile servers. Pattern mirrors
  // the Bing option in the main WellMap; this component locks it as the only
  // basemap (no toggle).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers:  [
          // Neutral fill so tile-load gaps don't flash white
          { id: 'bg', type: 'background', paint: { 'background-color': '#0b0b0b' } },
        ],
      },
      center: [-82.7, 40.3],   // center of Ohio as safe default
      zoom:   7,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');

    map.on('load', () => {
      map.addSource('bing-satellite', {
        type: 'raster',
        tiles: ['/api/bing-tiles/{z}/{x}/{y}'],
        tileSize: 256,
        attribution: '© Microsoft Bing Maps (Vexcel)',
      });
      map.addLayer({
        id:     'bing-layer',
        type:   'raster',
        source: 'bing-satellite',
        paint:  { 'raster-opacity': 1.0 },
      });
      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render wells (when both map is loaded and data is present) + auto-fit bounds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || wells.length === 0) return;

    const features: GeoJSON.Feature[] = wells.map(w => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
      properties: {
        api_no:       w.api_no,
        priority:     w.priority ?? 'low',
        composite:    w.composite_risk_score,
        operator:     w.operator,
        status:       w.status,
        well_name:    w.well_name,
        admin_status: w.admin_status,
      },
    }));

    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    const existingSource = map.getSource('county-wells') as mapboxgl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(fc);
    } else {
      map.addSource('county-wells', { type: 'geojson', data: fc });

      for (const p of PRIORITY_DRAW_ORDER) {
        map.addLayer({
          id:     `county-wells-${p}`,
          type:   'circle',
          source: 'county-wells',
          filter: ['==', ['get', 'priority'], p],
          paint: {
            'circle-radius':       PRIORITY_RADIUS[p],
            'circle-color':        PRIORITY_COLOR[p],
            // Light ring contrasts well against both shadow and bright aerial areas
            'circle-stroke-width':       p === 'critical' || p === 'high' ? 1.4 : 1.0,
            'circle-stroke-color':       '#ffffff',
            'circle-stroke-opacity':     0.9,
            'circle-opacity':            PRIORITY_OPACITY[p],
          },
        });
      }

      // Click-to-popup. One handler covers every tier via layer array.
      const layerIds = PRIORITY_DRAW_ORDER.map(p => `county-wells-${p}`);
      map.on('click', (e) => {
        const feats = map.queryRenderedFeatures(e.point, { layers: layerIds });
        if (!feats.length) return;
        const p = feats[0].properties as Record<string, unknown>;
        const priority      = (p.priority as Priority) ?? null;
        const priorityColor = priority ? PRIORITY_COLOR[priority] : '#64748b';
        const composite     = p.composite != null ? (p.composite as number).toFixed(1) : '—';
        const operator      = (p.operator as string) ?? null;
        const status        = (p.status as string) ?? '—';
        const wellName      = (p.well_name as string) ?? '(unnamed well)';
        const apiNo         = p.api_no as string;
        const adminLabel    = p.admin_status
          ? (ADMIN_STATUS_LABEL[p.admin_status as AdminStatus] ?? (p.admin_status as string))
          : '—';
        const isHistoric    = operator === 'HISTORIC OWNER';

        const operatorHtml = operator
          ? `<a href="/operators/${encodeURIComponent(operator)}" style="color:${isHistoric ? '#fdba74' : '#93c5fd'};text-decoration:none;border-bottom:1px dashed ${isHistoric ? 'rgba(253,186,116,0.4)' : 'rgba(147,197,253,0.4)'}">${escapeHtml(operator)}</a>`
          : '<span style="color:#64748b">—</span>';

        const lngLat = e.lngLat;
        new mapboxgl.Popup({
          closeButton: true,
          maxWidth:    '300px',
          className:   'county-well-popup',
          offset:      14,
        })
          .setLngLat(lngLat)
          .setHTML(`
            <div style="min-width:240px;max-width:280px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b1220;color:#e5e7eb">
              <div style="height:3px;background:${priorityColor}"></div>
              <div style="padding:11px 28px 12px 13px">
                <a href="/wells/${encodeURIComponent(apiNo)}" style="display:block;text-decoration:none;color:inherit">
                  <div style="font-weight:600;font-size:13px;color:#fff;line-height:1.3;border-bottom:1px dashed rgba(147,197,253,0.3);display:inline-block;padding-bottom:1px">${escapeHtml(wellName)}</div>
                  <div style="font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#64748b;margin-top:3px;letter-spacing:0.3px">API: ${escapeHtml(apiNo)} →</div>
                </a>

                <div style="display:flex;align-items:center;gap:8px;margin:11px 0 10px">
                  <span style="padding:2px 7px;border-radius:9999px;background:${priorityColor};color:#000;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px">${priority ?? '—'}</span>
                  <span style="font-size:18px;font-weight:700;color:${priorityColor};line-height:1">${composite}</span>
                  <span style="font-size:10px;color:#64748b">composite / 100</span>
                </div>

                <div style="display:grid;grid-template-columns:56px 1fr;row-gap:5px;column-gap:10px;font-size:11px;line-height:1.4;margin-bottom:10px">
                  <span style="color:#64748b">Operator</span>
                  <span style="word-break:break-word">${operatorHtml}</span>
                  <span style="color:#64748b">Status</span>
                  <span style="color:#cbd5e1">${escapeHtml(status)}</span>
                  <span style="color:#64748b">Admin</span>
                  <span style="color:#cbd5e1">${escapeHtml(adminLabel)}</span>
                </div>

                <div style="display:flex;gap:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
                  <a href="/wells/${encodeURIComponent(apiNo)}" style="flex:1;text-align:center;padding:5px 8px;font-size:11px;font-weight:600;color:#bfdbfe;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.35);border-radius:4px;text-decoration:none">See more →</a>
                  <a href="/?lat=${lngLat.lat}&lng=${lngLat.lng}&api=${encodeURIComponent(apiNo)}" style="flex:1;text-align:center;padding:5px 8px;font-size:11px;font-weight:600;color:#e5e7eb;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;text-decoration:none">📍 Full map</a>
                </div>
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mousemove', (e) => {
        const feats = map.queryRenderedFeatures(e.point, { layers: layerIds });
        map.getCanvas().style.cursor = feats.length ? 'pointer' : '';
      });
    }

    // Auto-fit bounds to the county's wells. Only run on the first data load —
    // re-fitting on every update would fight the user's zoom.
    const bounds = new mapboxgl.LngLatBounds();
    for (const w of wells) bounds.extend([w.lng, w.lat]);
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 40, maxZoom: 11, duration: 0 });
    }
  }, [mapLoaded, wells]);

  // Count wells per priority for the legend.
  const counts = wells.reduce<Record<string, number>>((acc, w) => {
    const k = w.priority ?? 'unscored';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="relative print:hidden">
      <div
        ref={containerRef}
        className="w-full h-[420px] rounded border border-gray-800"
      />

      {/* Legend */}
      <div className="absolute top-2 left-2 bg-gray-900/90 border border-gray-700 rounded px-3 py-2 text-[10px] space-y-1 backdrop-blur-sm pointer-events-none">
        <div className="text-gray-400 uppercase tracking-wider mb-1" style={{ fontSize: '9px' }}>
          {wells.length.toLocaleString()} wells
        </div>
        {(['critical', 'high', 'medium', 'low'] as Priority[]).map(p => (
          <div key={p} className="flex items-center gap-2">
            <span
              className="inline-block rounded-full"
              style={{ width: 8, height: 8, background: PRIORITY_COLOR[p] }}
            />
            <span className="capitalize text-gray-300 w-16">{p}</span>
            <span className="text-gray-500 font-mono">{(counts[p] ?? 0).toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* Loading overlay */}
      {loadingMsg && (
        <div className="absolute bottom-2 right-2 bg-gray-900/90 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-400 font-mono pointer-events-none">
          {loadingMsg}
        </div>
      )}
    </div>
  );
}

// Minimal HTML-escape for popup content. Mapbox's .setHTML does not sanitize,
// so any user-controllable field (well_name, operator, status, api_no) must
// pass through this to prevent HTML injection from bad data.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
