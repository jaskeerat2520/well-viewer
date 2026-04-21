'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';
import { WellDetail, Priority, PRIORITY_COLOR, CountySummary, WATER_SOURCE_COLOR, NearYouResult } from '@/lib/types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;


const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

type CountyMetric = 'avg_risk_score' | 'critical_count' | 'high_count' | 'medium_count' | 'low_count' | 'annual_co2e_mt';

const COUNTY_METRIC_LABELS: Record<CountyMetric, string> = {
  avg_risk_score: 'Avg risk',
  critical_count: 'Critical',
  high_count:     'High',
  medium_count:   'Medium',
  low_count:      'Low',
  annual_co2e_mt: 'Emissions',
};

// Color expression per metric — each has its own meaningful scale
function countyColorExpression(metric: CountyMetric): mapboxgl.Expression {
  const field: mapboxgl.Expression = ['coalesce', ['get', metric], 0];
  if (metric === 'avg_risk_score') {
    return ['interpolate', ['linear'], field,
      0,  '#1e3a5f',
      20, '#2563eb',
      35, '#f97316',
      50, '#ef4444',
    ];
  }
  if (metric === 'critical_count') {
    return ['interpolate', ['linear'], field,
      0,   '#1e3a5f',
      1,   '#ef4444',
      50,  '#7f1d1d',
    ];
  }
  if (metric === 'high_count') {
    return ['interpolate', ['linear'], field,
      0,   '#1e3a5f',
      50,  '#f97316',
      500, '#7c2d12',
    ];
  }
  if (metric === 'medium_count') {
    return ['interpolate', ['linear'], field,
      0,    '#1e3a5f',
      200,  '#eab308',
      2000, '#713f12',
    ];
  }
  if (metric === 'annual_co2e_mt') {
    return ['interpolate', ['linear'], field,
      0,     '#1e3a5f',
      200,   '#78350f',
      500,   '#d97706',
      2500,  '#c2410c',
      10000, '#7c2d12',
    ];
  }
  // low_count
  return ['interpolate', ['linear'], field,
    0,    '#1e3a5f',
    500,  '#22c55e',
    5000, '#14532d',
  ];
}

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
}

interface Props {
  filters: Priority[];
  onFilterChange: (p: Priority) => void;
  onSelectWell: (well: WellDetail | null) => void;
  onSelectCounty: (county: CountySummary | null) => void;
  onNearYouResult: (result: NearYouResult | null) => void;
  centerOn?: { lat: number; lng: number } | null;
}

export default function WellMap({ filters, onFilterChange, onSelectWell, onSelectCounty, onNearYouResult, centerOn }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [loadStatus, setLoadStatus] = useState('Loading critical + high wells…');
  const [satellite, setSatellite] = useState<'off' | 'bing' | 'esri' | 'mapbox' | 'osip'>('off');
  const [countyMetric, setCountyMetric] = useState<CountyMetric>('avg_risk_score');
  const [showCounties, setShowCounties] = useState(true);
  const [showWaterSources, setShowWaterSources] = useState(false);
  const [waterSourcesLoaded, setWaterSourcesLoaded] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number; y: number; priority: Priority; risk_score: number | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<MapboxFeature[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-82.8, 40.4],  // Center of Ohio
      zoom: 6.5,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('load', async () => {
      const m = map.current!;

      // ── Satellite imagery (bottom of layer stack, hidden by default) ──────
      m.addSource('bing-satellite', {
        type: 'raster',
        tiles: ['/api/bing-tiles/{z}/{x}/{y}'],
        tileSize: 256,
        attribution: '© Microsoft Bing Maps (Vexcel)',
      });
      m.addSource('esri-satellite', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: 'Esri, Maxar, Earthstar Geographics',
      });
      m.addSource('mapbox-satellite', {
        type: 'raster',
        url: 'mapbox://mapbox.satellite',
        tileSize: 256,
      });
      // Ohio OSIP — 1ft resolution state aerial, best available year per county
      m.addSource('osip-satellite', {
        type: 'raster',
        tiles: ['https://geo.oit.ohio.gov/arcgis/rest/services/OSIP/osip_best_avail_1ft/ImageServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Ohio OIT / OGRIP — Ohio Statewide Imagery Program',
        minzoom: 7,   // OSIP tiles only exist at county-level zoom and above
      });
      m.addLayer({
        id: 'bing-layer',
        type: 'raster',
        source: 'bing-satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1.0 },
      });
      m.addLayer({
        id: 'esri-layer',
        type: 'raster',
        source: 'esri-satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.9 },
      });
      m.addLayer({
        id: 'satellite-layer',
        type: 'raster',
        source: 'mapbox-satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.85 },
      });
      m.addLayer({
        id: 'osip-layer',
        type: 'raster',
        source: 'osip-satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1.0 },
      });

      // ── County choropleth (rendered beneath well dots) ───────────────────
      const { data: countyRows, error: countyError } = await supabase.from('county_map_view').select('*');
      if (countyError) console.error('[counties] fetch error:', countyError);
      console.log('[counties] rows returned:', countyRows?.length ?? 0);

      const { data: emissionsRows } = await supabase
        .from('county_emissions_summary')
        .select('county, annual_co2e_mt, cars_equivalent');
      const emissionsMap = new Map(
        emissionsRows?.map(r => [r.county, { annual_co2e_mt: Number(r.annual_co2e_mt), cars_equivalent: r.cars_equivalent }]) ?? []
      );

      if (countyRows && countyRows.length > 0) {
        const countyFeatures: GeoJSON.Feature[] = countyRows
          .filter(row => row.geojson)
          .map(row => ({
            type: 'Feature' as const,
            // PostgREST may return geojson as a pre-parsed object or as a string
            geometry: typeof row.geojson === 'string' ? JSON.parse(row.geojson) : row.geojson,
            properties: {
              fips_code:         row.fips_code,
              county:            row.county,
              total_wells:       row.total_wells,
              scored_wells:      row.scored_wells,
              avg_risk_score:    row.avg_risk_score,
              critical_count:    row.critical_count,
              high_count:        row.high_count,
              medium_count:      row.medium_count,
              low_count:         row.low_count,
              in_orphan_program: row.in_orphan_program,
              cost_low:          row.cost_low,
              cost_mid:          row.cost_mid,
              cost_high:         row.cost_high,
              annual_co2e_mt:    emissionsMap.get(row.county)?.annual_co2e_mt ?? null,
              cars_equivalent:   emissionsMap.get(row.county)?.cars_equivalent ?? null,
            },
          }));

        console.log('[counties] features built:', countyFeatures.length, 'sample geometry type:', countyFeatures[0]?.geometry?.type);

        m.addSource('counties', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: countyFeatures },
        });

        m.addLayer({
          id: 'counties-fill',
          type: 'fill',
          source: 'counties',
          paint: {
            'fill-color': [
              'interpolate', ['linear'],
              ['coalesce', ['get', 'avg_risk_score'], 0],
              0,  '#1e3a5f',
              20, '#2563eb',
              35, '#f97316',
              50, '#ef4444',
            ],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.45, 10, 0.22],
          },
        });

        m.addLayer({
          id: 'counties-line',
          type: 'line',
          source: 'counties',
          paint: {
            'line-color': '#94a3b8',
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 10, 0.65],
            'line-width':   ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.2],
          },
        });

        m.on('click', 'counties-fill', (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const bounds = getGeometryBounds(feature.geometry as GeoJSON.Geometry);
          if (bounds) {
            m.fitBounds(bounds, {
              padding: { top: 60, bottom: 60, left: 60, right: 360 },
              maxZoom: 10,
              duration: 700,
              essential: true,
            });
          }
          onSelectCounty(feature.properties as CountySummary);
          onSelectWell(null);
          e.originalEvent.stopPropagation();
        });

        m.on('mouseenter', 'counties-fill', () => {
          m.getCanvas().style.cursor = 'pointer';
        });
        m.on('mouseleave', 'counties-fill', () => {
          m.getCanvas().style.cursor = '';
        });
      }

      // ── Water source protection zones (between counties and wells) ──────────
      m.addSource('water-sources', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      const waterColorExpr: mapboxgl.Expression = [
        'match', ['get', 'source_type'],
        'groundwater',              WATER_SOURCE_COLOR.groundwater,
        'surface_water_inland',     WATER_SOURCE_COLOR.surface_water_inland,
        'surface_water_lake_erie',  WATER_SOURCE_COLOR.surface_water_lake_erie,
        'surface_water_ohio_river', WATER_SOURCE_COLOR.surface_water_ohio_river,
        '#94a3b8',
      ];

      m.addLayer({
        id: 'water-sources-fill',
        type: 'fill',
        source: 'water-sources',
        minzoom: 7,
        layout: { visibility: 'none' },
        paint: { 'fill-color': waterColorExpr, 'fill-opacity': 0.18 },
      });

      m.addLayer({
        id: 'water-sources-outline',
        type: 'line',
        source: 'water-sources',
        minzoom: 7,
        layout: { visibility: 'none' },
        paint: { 'line-color': waterColorExpr, 'line-opacity': 0.65, 'line-width': 1.0 },
      });

      m.on('click', 'water-sources-fill', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        new mapboxgl.Popup({ maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px">${props.name ?? 'Unnamed Zone'}</div>
              <div style="color:#9ca3af">Type: <span style="color:#fff">${props.source_type.replace(/_/g, ' ')}</span></div>
              <div style="color:#9ca3af">Zone: <span style="color:#fff">${props.protection_zone.replace(/_/g, ' ')}</span></div>
              ${props.public_water_system ? `<div style="color:#9ca3af">PWS: <span style="color:#fff">${props.public_water_system}</span></div>` : ''}
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'water-sources-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'water-sources-fill', () => { m.getCanvas().style.cursor = ''; });

      // ── Wells source + layers (on top of counties) ───────────────────────
      // Add empty source first — we'll populate it progressively
      m.addSource('wells', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: false,
      });

      // Layer creation order controls z-order: layers added LATER render ON TOP.
      // We want: low (bottom) → medium → high-glow → high → critical-glow → critical (top)
      // This ensures critical wells are never buried under the much larger low/medium populations.

      const addWellLayer = (priority: Priority) => {
        const baseRadius = priority === 'critical' ? 6 : priority === 'high' ? 4.5 : 3.5;
        m.addLayer({
          id: `wells-${priority}`,
          type: 'circle',
          source: 'wells',
          filter: ['==', ['get', 'priority'], priority],
          paint: {
            'circle-color': PRIORITY_COLOR[priority],
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5,  baseRadius * 0.4,
              8,  baseRadius,
              12, baseRadius * 1.5,
              15, baseRadius * 2.0,
            ],
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, priority === 'critical' ? 1.0 : 0.8],
            'circle-stroke-width': priority === 'critical' ? 1.5 : 0,
            'circle-stroke-color': '#fff',
          },
        });

        m.on('click', `wells-${priority}`, async (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
          m.flyTo({ center: coords, zoom: Math.max(m.getZoom(), 12), duration: 600, essential: true });
          const api_no = feature.properties?.api_no as string;
          const detail = await fetchWellDetail(api_no);
          onSelectWell(detail);
          e.originalEvent.stopPropagation();
        });

        m.on('mousemove', `wells-${priority}`, (e) => {
          m.getCanvas().style.cursor = 'pointer';
          const props = e.features?.[0]?.properties;
          if (!props) return;
          setHoverInfo({
            x: e.point.x,
            y: e.point.y,
            priority: props.priority as Priority,
            risk_score: props.risk_score ?? null,
          });
        });
        m.on('mouseleave', `wells-${priority}`, () => {
          m.getCanvas().style.cursor = '';
          setHoverInfo(null);
        });
      };

      const addGlowLayer = (priority: Priority, glowRadius: [number, number, number], opacity: number) => {
        m.addLayer({
          id: `wells-${priority}-glow`,
          type: 'circle',
          source: 'wells',
          filter: ['==', ['get', 'priority'], priority],
          paint: {
            'circle-color': PRIORITY_COLOR[priority],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, glowRadius[0], 9, glowRadius[1], 13, glowRadius[2]],
            'circle-opacity': opacity,
            'circle-blur': 1,
          },
        });
      };

      // Build up from bottom: low → medium → high-glow → high → critical-glow → critical
      addWellLayer('low');
      addWellLayer('medium');
      addGlowLayer('high', [2, 8, 14], 0.15);
      addWellLayer('high');
      addGlowLayer('critical', [4, 14, 22], 0.22);
      addWellLayer('critical');

      // Clicking blank map clears both selections
      m.on('click', () => {
        onSelectWell(null);
        onSelectCounty(null);
      });

      // Shared accumulator so both load passes build on each other
      const allFeatures: GeoJSON.Feature[] = [];
      await loadWells(['critical', 'high'], m, allFeatures, setLoadStatus);
      setLoadStatus('Loading remaining wells…');
      await loadWells(['medium', 'low'], m, allFeatures, setLoadStatus);
      setLoadStatus('');
    });

    return () => { map.current?.remove(); map.current = null; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filter visibility whenever filters prop changes
  useEffect(() => {
    if (!map.current) return;
    PRIORITY_ORDER.forEach(priority => {
      const vis = filters.includes(priority) ? 'visible' : 'none';
      const layerId = `wells-${priority}`;
      if (map.current!.getLayer(layerId))
        map.current!.setLayoutProperty(layerId, 'visibility', vis);
      const glowId = `wells-${priority}-glow`;
      if (map.current!.getLayer(glowId))
        map.current!.setLayoutProperty(glowId, 'visibility', vis);
    });
  }, [filters]);

  // Sync satellite layer visibility
  useEffect(() => {
    if (!map.current?.getLayer('satellite-layer')) return;
    map.current.setLayoutProperty('bing-layer',      'visibility', satellite === 'bing'   ? 'visible' : 'none');
    map.current.setLayoutProperty('esri-layer',      'visibility', satellite === 'esri'   ? 'visible' : 'none');
    map.current.setLayoutProperty('satellite-layer', 'visibility', satellite === 'mapbox' ? 'visible' : 'none');
    map.current.setLayoutProperty('osip-layer',      'visibility', satellite === 'osip'   ? 'visible' : 'none');
  }, [satellite]);

  // Fly to well when selected via API lookup
  useEffect(() => {
    if (!centerOn || !map.current) return;
    map.current.flyTo({ center: [centerOn.lng, centerOn.lat], zoom: Math.max(map.current.getZoom(), 13), duration: 700, essential: true });
  }, [centerOn]);

  // Toggle county layer visibility
  useEffect(() => {
    if (!map.current?.getLayer('counties-fill')) return;
    const vis = showCounties ? 'visible' : 'none';
    map.current.setLayoutProperty('counties-fill', 'visibility', vis);
    map.current.setLayoutProperty('counties-line', 'visibility', vis);
  }, [showCounties]);

  // Toggle water source layer visibility + lazy-load data on first show
  useEffect(() => {
    if (!map.current?.getLayer('water-sources-fill')) return;
    const vis = showWaterSources ? 'visible' : 'none';
    map.current.setLayoutProperty('water-sources-fill',    'visibility', vis);
    map.current.setLayoutProperty('water-sources-outline', 'visibility', vis);
    if (showWaterSources && !waterSourcesLoaded) {
      loadWaterSources(map.current).then(ok => { if (ok) setWaterSourcesLoaded(true); });
    }
  }, [showWaterSources, waterSourcesLoaded]);

  // Recolor county choropleth when metric changes
  useEffect(() => {
    if (!map.current?.getLayer('counties-fill')) return;
    map.current.setPaintProperty(
      'counties-fill',
      'fill-color',
      countyColorExpression(countyMetric)
    );
  }, [countyMetric]);

  // Debounced geocoding for address search
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 3) { setSearchSuggestions([]); return; }
    searchDebounceRef.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const bbox = '-84.8,38.4,-80.5,41.9';
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=US&bbox=${bbox}&access_token=${token}&limit=5`
        );
        const json = await res.json();
        setSearchSuggestions(json.features ?? []);
      } catch {
        setSearchSuggestions([]);
      }
    }, 300);
  }, [searchQuery]);

  async function handleSelectPlace(feature: MapboxFeature) {
    const [lng, lat] = feature.center;
    const shortName = feature.place_name.split(',')[0];
    setSearchQuery(shortName);
    setSearchSuggestions([]);

    if (map.current) {
      map.current.flyTo({ center: [lng, lat], zoom: 12, duration: 800, essential: true });
    }

    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([lng, lat]);
    } else if (map.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#60a5fa;border:3px solid #fff;box-shadow:0 0 0 6px rgba(96,165,250,0.2)';
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map.current);
    }

    try {
      const res = await fetch(`/api/wells-near?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const data = await res.json();
        onNearYouResult({ ...data, place_name: shortName });
      }
    } catch (err) {
      console.error('[wells-near]', err);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchSuggestions([]);
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
    onNearYouResult(null);
  }

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Map controls — top-left */}
      <div className="absolute top-3 left-3 flex flex-col gap-2">

        {/* Address search */}
        <div className="relative">
          <div className="flex gap-1">
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); if (!e.target.value) clearSearch(); }}
              placeholder="Find wells near you…"
              className="w-44 px-2.5 py-1.5 rounded text-xs bg-black/80 text-white border border-white/30 placeholder-gray-500 focus:outline-none focus:border-blue-400"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="px-2 py-1.5 rounded text-xs bg-black/70 border border-white/20 text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          {searchSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-gray-900 border border-gray-700 rounded shadow-xl z-50 overflow-hidden">
              {searchSuggestions.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleSelectPlace(s)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 hover:text-white border-b border-gray-800 last:border-0 transition-colors"
                >
                  {s.place_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reset view */}
        <button
          onClick={() => map.current?.flyTo({ center: [-82.8, 40.4], zoom: 6.5, duration: 800, essential: true })}
          className="px-3 py-1.5 rounded text-xs font-medium border transition-colors"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
          title="Reset to Ohio view"
        >
          ⌂ Ohio
        </button>

        {/* Satellite toggle — cycles off → Bing → Esri → Mapbox → Ohio OSIP → off */}
        <button
          onClick={() => setSatellite(s =>
            s === 'off' ? 'bing' : s === 'bing' ? 'esri' : s === 'esri' ? 'mapbox' : s === 'mapbox' ? 'osip' : 'off'
          )}
          className="px-3 py-1.5 rounded text-xs font-medium border transition-colors"
          style={{
            backgroundColor: satellite !== 'off' ? '#fff' : 'rgba(0,0,0,0.7)',
            color:            satellite !== 'off' ? '#000' : '#fff',
            borderColor:      satellite !== 'off' ? '#ccc' : 'rgba(255,255,255,0.3)',
          }}
        >
          🛰 {satellite === 'bing' ? 'Bing (Vexcel)' : satellite === 'esri' ? 'Esri imagery' : satellite === 'mapbox' ? 'Mapbox imagery' : satellite === 'osip' ? 'Ohio OSIP (1ft)' : 'Satellite'}
        </button>

        {/* Priority filters — well dots */}
        <div className="flex flex-col gap-1 bg-black/70 rounded p-2 border border-white/10">
          <span className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Wells</span>
          {PRIORITY_ORDER.map(p => {
            const active = filters.includes(p);
            return (
              <button
                key={p}
                onClick={() => onFilterChange(p)}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                style={{
                  backgroundColor: active ? PRIORITY_COLOR[p] : 'transparent',
                  color: active ? '#000' : PRIORITY_COLOR[p],
                  border: `1px solid ${PRIORITY_COLOR[p]}`,
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span className="w-16 capitalize">{p}</span>
              </button>
            );
          })}
        </div>

        {/* County choropleth metric */}
        <div className="flex flex-col gap-1 bg-black/70 rounded p-2 border border-white/10">
          <button
            onClick={() => setShowCounties(prev => !prev)}
            className="flex items-center justify-between text-xs uppercase tracking-wider mb-1 font-medium w-full"
            style={{ color: showCounties ? '#fff' : '#6b7280' }}
          >
            <span>County boundaries</span>
            <span className="ml-2">{showCounties ? '●' : '○'}</span>
          </button>
          {showCounties && (Object.keys(COUNTY_METRIC_LABELS) as CountyMetric[]).map(m => {
            const active = countyMetric === m;
            const color = m === 'avg_risk_score'  ? '#a78bfa'
              : m === 'critical_count'  ? PRIORITY_COLOR.critical
              : m === 'high_count'      ? PRIORITY_COLOR.high
              : m === 'medium_count'    ? PRIORITY_COLOR.medium
              : m === 'annual_co2e_mt'  ? '#f59e0b'
              : PRIORITY_COLOR.low;
            return (
              <button
                key={m}
                onClick={() => setCountyMetric(m)}
                className="px-2 py-1 rounded text-xs font-medium text-left transition-opacity"
                style={{
                  backgroundColor: active ? color : 'transparent',
                  color: active ? '#000' : color,
                  border: `1px solid ${color}`,
                  opacity: active ? 1 : 0.5,
                }}
              >
                {COUNTY_METRIC_LABELS[m]}
              </button>
            );
          })}
        </div>

        {/* Water zones toggle */}
        <div className="flex flex-col gap-1 bg-black/70 rounded p-2 border border-white/10">
          <button
            onClick={() => setShowWaterSources(prev => !prev)}
            className="flex items-center justify-between text-xs uppercase tracking-wider"
            style={{ color: showWaterSources ? '#0891b2' : '#6b7280' }}
          >
            <span>Water Zones</span>
            <span className="ml-3">{showWaterSources ? '●' : '○'}</span>
          </button>
          {showWaterSources && !waterSourcesLoaded && (
            <p className="text-xs text-gray-500 mt-1">Loading…</p>
          )}
        </div>
      </div>

      {hoverInfo && (
        <div
          className="absolute pointer-events-none z-20 bg-gray-900/95 border border-gray-600 rounded px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y - 14 }}
        >
          <span style={{ color: PRIORITY_COLOR[hoverInfo.priority], fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {hoverInfo.priority}
          </span>
          {hoverInfo.risk_score != null && (
            <span className="text-gray-400 ml-2 font-mono">{hoverInfo.risk_score.toFixed(1)}</span>
          )}
        </div>
      )}

      {loadStatus && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-4 py-2 rounded-full">
          {loadStatus}
        </div>
      )}
    </div>
  );
}

// Fetch one priority group from the flat view, merge into shared accumulator
async function loadWells(
  priorities: Priority[],
  m: mapboxgl.Map,
  allFeatures: GeoJSON.Feature[],
  setStatus: (s: string) => void,
) {
  let page = 0;
  const PAGE = 1000;

  const source = m.getSource('wells') as mapboxgl.GeoJSONSource;

  while (true) {
    const { data, error } = await supabase
      .from('well_map_view')
      .select('api_no, lat, lng, priority, risk_score')
      .in('priority', priorities)
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data) {
      if (!row.lat || !row.lng) continue;
      allFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: { api_no: row.api_no, priority: row.priority, risk_score: row.risk_score },
      });
    }

    if (source) {
      source.setData({ type: 'FeatureCollection', features: allFeatures });
    }

    setStatus(`Loaded ${allFeatures.length.toLocaleString()} wells…`);

    if (data.length < PAGE) break;
    page++;
  }
}

async function loadWaterSources(m: mapboxgl.Map): Promise<boolean> {
  try {
    const res = await fetch('/api/water-sources');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('water-sources') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[water-sources]', err);
    return false;
  }
}

function getGeometryBounds(geometry: GeoJSON.Geometry): mapboxgl.LngLatBoundsLike | null {
  const coords: number[][] = [];
  if (geometry.type === 'Polygon') {
    geometry.coordinates[0].forEach(c => coords.push(c));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(poly => poly[0].forEach(c => coords.push(c)));
  }
  if (!coords.length) return null;
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

async function fetchWellDetail(api_no: string): Promise<WellDetail | null> {
  const { data, error } = await supabase
    .from('well_map_view')
    .select('*')
    .eq('api_no', api_no)
    .single();

  if (error || !data) return null;

  return {
    api_no:                   data.api_no,
    priority:                 data.priority,
    risk_score:               data.risk_score,
    water_risk_score:         data.water_risk_score,
    population_risk_score:    data.population_risk_score,
    inactivity_score:         data.inactivity_score,
    nearest_water_distance_m: data.nearest_water_distance_m,
    within_protection_zone:   data.within_protection_zone,
    operator_status:          data.operator_status,
    population_within_1km:    data.population_within_1km,
    population_within_5km:    data.population_within_5km,
    years_inactive:           data.years_inactive,
    well: {
      well_name: data.well_name,
      county:    data.county,
      status:    data.status,
      operator:  data.operator,
      well_type: data.well_type,
      lat:       data.lat,
      lng:       data.lng,
    },
  } as WellDetail;
}
