'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';
import { WellDetail, Priority, PRIORITY_COLOR, CountySummary, WATER_SOURCE_COLOR, NearYouResult, LandCoverCode, LAND_COVER_LABEL, LAND_COVER_COLOR } from '@/lib/types';

type ColorMode = 'priority' | 'emissions' | 'vegetation' | 'terrain';

const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  priority:   'Priority',
  emissions:  'Emissions',
  vegetation: 'Vegetation',
  terrain:    'Terrain',
};

const COLOR_MODE_SCORE_FIELD: Record<Exclude<ColorMode, 'priority'>, string> = {
  emissions:  'emissions_risk_score',
  vegetation: 'vegetation_risk_score',
  terrain:    'terrain_risk_score',
};

function rsScoreColorExpr(field: string): mapboxgl.Expression {
  return [
    'interpolate', ['linear'],
    ['coalesce', ['get', field], 0],
    0,   '#1e3a5f',
    25,  '#2563eb',
    50,  '#f97316',
    75,  '#ef4444',
    100, '#7f1d1d',
  ];
}

type RsFlag = 'ch4' | 'plume' | 'veg' | 'flat' | 'cluster';

const RS_FLAG_LABEL: Record<RsFlag, string> = {
  ch4:     'CH₄ anomaly',
  plume:   'Near plume',
  veg:     'Vegetation loss',
  flat:    'Artificially flat',
  cluster: 'Clustered (≥2 neighbors 10–30m)',
};

const RS_FLAG_COLOR: Record<RsFlag, string> = {
  ch4:     '#f59e0b',
  plume:   '#dc2626',
  veg:     '#14b8a6',
  flat:    '#a78bfa',
  cluster: '#ec4899',
};

const RS_FLAG_EXPR: Record<RsFlag, mapboxgl.Expression> = {
  ch4:     ['==', ['get', 'ch4_is_anomaly'], true],
  plume:   ['in', ['get', 'ch4_signal_source'], ['literal', ['plume:carbonmapper', 'plume:methaneair']]],
  veg:     ['==', ['get', 'veg_anomaly_detected'], true],
  flat:    ['==', ['get', 'is_artificially_flat'], true],
  cluster: ['>=', ['coalesce', ['get', 'cluster_neighbor_count'], 0], 2],
};

type WellsTab = 'priority' | 'color' | 'flags' | 'land';

const WELLS_TABS: { key: WellsTab; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'color',    label: 'Color'    },
  { key: 'flags',    label: 'Flags'    },
  { key: 'land',     label: 'Land'     },
];

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;


const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

// Full set of WorldCover codes we classify in score_land_cover.py. If every
// code is selected (or the user toggled "all"), we skip the land-cover filter
// expression entirely so wells with a NULL land_cover stay visible too.
const LAND_COVER_CODES: LandCoverCode[] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];

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
  const [loadStatus, setLoadStatus] = useState('Loading critical wells…');
  // 'all' → show every class including wells with null land_cover. A Set →
  // restrict to those specific codes (wells with null get hidden).
  const [landCoverFilter, setLandCoverFilter] = useState<Set<LandCoverCode> | 'all'>('all');
  const [satellite, setSatellite] = useState<'off' | 'bing' | 'esri' | 'mapbox' | 'osip'>('off');
  const [countyMetric, setCountyMetric] = useState<CountyMetric>('avg_risk_score');
  const [showCounties, setShowCounties] = useState(true);
  const [showWaterSources, setShowWaterSources] = useState(false);
  const [waterSourcesLoaded, setWaterSourcesLoaded] = useState(false);
  const [showPlumes, setShowPlumes] = useState(false);
  const [plumesLoaded, setPlumesLoaded] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('priority');
  const [rsFlags, setRsFlags] = useState<Set<RsFlag>>(new Set());
  const [wellsTab, setWellsTab] = useState<WellsTab>('priority');
  // Hard filter (AND'd onto every priority tier): exclude wells that have a
  // named active operator — i.e. keep only historic_owner + orphan_program.
  // Unlike RS flags this applies to critical too, since it's an explicit
  // "plugging candidates only" intent rather than a soft signal.
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number; y: number; priority: Priority; risk_score: number | null; api_no: string; county: string;
    emissions_risk_score: number | null; vegetation_risk_score: number | null; terrain_risk_score: number | null;
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
          // Mapbox fires click events independently for every layer intersecting
          // the click point, and e.originalEvent.stopPropagation() stops only
          // the DOM event — not Mapbox's layer-click delegation. So a plume or
          // well click would also trigger this county handler and its fitBounds
          // (maxZoom: 10) would yank the user back to zoom 10 whenever they're
          // more zoomed in. Guard by checking for higher-priority features at
          // the same point; if any exist, defer to their handlers.
          const topHits = m.queryRenderedFeatures(e.point, {
            layers: ['methane-plumes-dot', 'wells-critical', 'wells-high', 'wells-medium', 'wells-low'],
          });
          if (topHits.length > 0) return;

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

      // ── Methane plume detections (CarbonMapper + MethaneAIR L4) ──────────
      m.addSource('methane-plumes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: 'methane-plumes-glow',
        type: 'circle',
        source: 'methane-plumes',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': [
            'interpolate', ['linear'], ['log10', ['max', ['coalesce', ['get', 'emission_kgph'], 1], 1]],
            1, '#fbbf24',   // 10 kg/hr
            2, '#f97316',   // 100 kg/hr
            3, '#dc2626',   // 1,000 kg/hr
            4, '#7f1d1d',   // 10,000 kg/hr
          ],
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5,  12,
            9,  24,
            13, 40,
          ],
          'circle-opacity': 0.25,
          'circle-blur': 1.2,
        },
      });

      m.addLayer({
        id: 'methane-plumes-dot',
        type: 'circle',
        source: 'methane-plumes',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': [
            'interpolate', ['linear'], ['log10', ['max', ['coalesce', ['get', 'emission_kgph'], 1], 1]],
            1, '#fbbf24',
            2, '#f97316',
            3, '#dc2626',
            4, '#7f1d1d',
          ],
          // Radius on a log(emission) + zoom ramp so a 10,000 kg/hr super-emitter
          // is visibly larger than a 100 kg/hr detection without drowning out
          // everything else at low zoom.
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, [
              'interpolate', ['linear'], ['log10', ['max', ['coalesce', ['get', 'emission_kgph'], 1], 1]],
              1, 3, 2, 4, 3, 6, 4, 9,
            ],
            10, [
              'interpolate', ['linear'], ['log10', ['max', ['coalesce', ['get', 'emission_kgph'], 1], 1]],
              1, 6, 2, 9, 3, 13, 4, 18,
            ],
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#000',
          'circle-opacity': 0.95,
        },
      });

      m.on('click', 'methane-plumes-dot', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const flux = Number(props.emission_kgph);
        const when = props.observed_at
          ? new Date(props.observed_at as string).toISOString().slice(0, 10)
          : '—';
        new mapboxgl.Popup({ maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px">CH₄ plume</div>
              <div style="color:#9ca3af">Flux: <span style="color:#fff">${isFinite(flux) ? flux.toFixed(0) + ' kg/hr' : '—'}</span></div>
              <div style="color:#9ca3af">Source: <span style="color:#fff">${props.source ?? '—'}</span></div>
              <div style="color:#9ca3af">Platform: <span style="color:#fff">${props.platform ?? '—'}</span></div>
              <div style="color:#9ca3af">Sector: <span style="color:#fff">${props.sector ?? '—'}</span></div>
              <div style="color:#9ca3af">Observed: <span style="color:#fff">${when}</span></div>
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'methane-plumes-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'methane-plumes-dot', () => { m.getCanvas().style.cursor = ''; });

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
            api_no: props.api_no ?? '',
            county: props.county ?? '',
            emissions_risk_score:  props.emissions_risk_score ?? null,
            vegetation_risk_score: props.vegetation_risk_score ?? null,
            terrain_risk_score:    props.terrain_risk_score ?? null,
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

      // Load in strict priority order — a combined `IN ('critical', 'high')`
      // query returns rows in DB-scan order, so critical dots wait behind
      // hundreds of high rows before the first render. Fetching critical
      // alone puts the 39 dots on the map within one round trip.
      const allFeatures: GeoJSON.Feature[] = [];
      setLoadStatus('Loading critical wells…');
      await loadWells(['critical'], m, allFeatures, setLoadStatus);
      setLoadStatus('Loading high-priority wells…');
      await loadWells(['high'], m, allFeatures, setLoadStatus);
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

  // Rebuild per-layer filter expressions whenever land-cover or RS flags change.
  // Each wells-<priority> layer originally used:
  //     ['==', ['get', 'priority'], priority]
  // We AND that with: land-cover `in` check, and OR-combined RS flag checks.
  useEffect(() => {
    if (!map.current) return;
    const lcExpr: mapboxgl.Expression | null =
      landCoverFilter === 'all'
        ? null
        : ['in', ['get', 'land_cover'], ['literal', Array.from(landCoverFilter)]];

    const flagExprs = Array.from(rsFlags).map(f => RS_FLAG_EXPR[f]);
    const flagExpr: mapboxgl.Expression | null =
      flagExprs.length === 0 ? null
      : flagExprs.length === 1 ? flagExprs[0]
      : (['any', ...flagExprs] as mapboxgl.Expression);

    // Hard filter: exclude wells that have an active named operator. Applied
    // to every priority tier (including critical) because this is an explicit
    // plugging-candidate intent, unlike RS flags which are soft signals.
    const orphanExpr: mapboxgl.Expression | null = orphansOnly
      ? ['!=', ['get', 'operator_status'], 'named_operator']
      : null;

    PRIORITY_ORDER.forEach(priority => {
      const base: mapboxgl.Expression = ['==', ['get', 'priority'], priority];
      const parts: mapboxgl.Expression[] = [base];
      if (lcExpr) parts.push(lcExpr);
      // Critical is the top tier by composite score — the scoring system has
      // already "flagged" these. RS flags are filters meant to narrow the bulk
      // of wells down to specific signals, so applying them to critical would
      // hide wells that are already maximally prioritised. Critical therefore
      // ignores RS flags and stays visible whenever its priority filter is on.
      if (flagExpr && priority !== 'critical') parts.push(flagExpr);
      if (orphanExpr) parts.push(orphanExpr);
      const combined: mapboxgl.Expression =
        parts.length === 1 ? parts[0] : (['all', ...parts] as mapboxgl.Expression);
      const layerId = `wells-${priority}`;
      const glowId  = `wells-${priority}-glow`;
      if (map.current!.getLayer(layerId)) map.current!.setFilter(layerId, combined);
      if (map.current!.getLayer(glowId))  map.current!.setFilter(glowId,  combined);
    });
  }, [landCoverFilter, rsFlags, orphansOnly]);

  // Dot recolors by selected RS score; glow stays pinned to PRIORITY_COLOR so
  // critical/high tiers remain recognizable even when most of their dots would
  // score 0 on the selected RS dimension and render as dark basemap-blue.
  useEffect(() => {
    if (!map.current) return;
    PRIORITY_ORDER.forEach(priority => {
      const layerId = `wells-${priority}`;
      const glowId  = `wells-${priority}-glow`;
      const dotColor: string | mapboxgl.Expression =
        colorMode === 'priority'
          ? PRIORITY_COLOR[priority]
          : rsScoreColorExpr(COLOR_MODE_SCORE_FIELD[colorMode]);
      if (map.current!.getLayer(layerId)) map.current!.setPaintProperty(layerId, 'circle-color', dotColor);
      if (map.current!.getLayer(glowId))  map.current!.setPaintProperty(glowId,  'circle-color', PRIORITY_COLOR[priority]);
    });
  }, [colorMode]);

  // Toggle methane plumes layer + lazy-load GeoJSON on first show
  useEffect(() => {
    if (!map.current?.getLayer('methane-plumes-dot')) return;
    const vis = showPlumes ? 'visible' : 'none';
    map.current.setLayoutProperty('methane-plumes-dot',  'visibility', vis);
    map.current.setLayoutProperty('methane-plumes-glow', 'visibility', vis);
    if (showPlumes && !plumesLoaded) {
      loadPlumes(map.current).then(ok => { if (ok) setPlumesLoaded(true); });
    }
  }, [showPlumes, plumesLoaded]);

  function toggleLandCover(code: LandCoverCode) {
    setLandCoverFilter(prev => {
      const next = new Set<LandCoverCode>(prev === 'all' ? LAND_COVER_CODES : prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      // Collapsing back to the full set is equivalent to 'all' semantically
      // but 'all' also shows wells where land_cover is NULL — preserve that.
      if (next.size === LAND_COVER_CODES.length) return 'all';
      return next;
    });
  }

  function resetLandCover() { setLandCoverFilter('all'); }

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

        {/* ── WELLS card (tabbed) ───────────────────────────────────────── */}
        <div className="flex flex-col gap-1 bg-black/70 rounded p-2 border border-white/10 w-52">
          <div className="flex gap-0.5 mb-1 bg-black/60 rounded p-0.5">
            {WELLS_TABS.map(t => {
              const active = wellsTab === t.key;
              // Mark tabs that currently have a non-default selection so the
              // user can tell at a glance that a hidden filter is active.
              const dirty =
                (t.key === 'priority' && filters.length < PRIORITY_ORDER.length) ||
                (t.key === 'color'    && colorMode !== 'priority') ||
                (t.key === 'flags'    && (rsFlags.size > 0 || orphansOnly)) ||
                (t.key === 'land'     && landCoverFilter !== 'all');
              return (
                <button
                  key={t.key}
                  onClick={() => setWellsTab(t.key)}
                  className="relative flex-1 px-1 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    backgroundColor: active ? '#fff' : 'transparent',
                    color: active ? '#000' : '#9ca3af',
                  }}
                >
                  {t.label}
                  {dirty && !active && (
                    <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-orange-400" />
                  )}
                </button>
              );
            })}
          </div>

          {wellsTab === 'priority' && (
            <div className="flex flex-col gap-1">
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
                    <span className="capitalize">{p}</span>
                  </button>
                );
              })}
            </div>
          )}

          {wellsTab === 'color' && (
            <div className="flex flex-col gap-1">
              {(Object.keys(COLOR_MODE_LABEL) as ColorMode[]).map(mode => {
                const active = colorMode === mode;
                const swatch = mode === 'priority' ? PRIORITY_COLOR.critical : '#ef4444';
                return (
                  <button
                    key={mode}
                    onClick={() => setColorMode(mode)}
                    className="px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                    style={{
                      backgroundColor: active ? swatch : 'transparent',
                      color: active ? '#000' : swatch,
                      border: `1px solid ${swatch}`,
                      opacity: active ? 1 : 0.5,
                    }}
                  >
                    {COLOR_MODE_LABEL[mode]}
                  </button>
                );
              })}
              {colorMode !== 'priority' && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                  <span>0</span>
                  <div className="flex-1 h-1.5 rounded" style={{
                    background: 'linear-gradient(to right, #1e3a5f, #2563eb, #f97316, #ef4444, #7f1d1d)',
                  }} />
                  <span>100</span>
                </div>
              )}
            </div>
          )}

          {wellsTab === 'flags' && (
            <div className="flex flex-col gap-1">
              {(rsFlags.size > 0 || orphansOnly) && (
                <button
                  onClick={() => { setRsFlags(new Set()); setOrphansOnly(false); }}
                  className="self-end text-[10px] text-gray-400 hover:text-white -mb-0.5"
                  title="Clear all flag filters"
                >
                  clear
                </button>
              )}
              {(Object.keys(RS_FLAG_LABEL) as RsFlag[]).map(flag => {
                const active = rsFlags.has(flag);
                const color = RS_FLAG_COLOR[flag];
                return (
                  <button
                    key={flag}
                    onClick={() => setRsFlags(prev => {
                      const next = new Set(prev);
                      if (next.has(flag)) next.delete(flag);
                      else next.add(flag);
                      return next;
                    })}
                    className="px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                    style={{
                      backgroundColor: active ? color : 'transparent',
                      color: active ? '#000' : color,
                      border: `1px solid ${color}`,
                      opacity: active ? 1 : 0.5,
                    }}
                  >
                    {RS_FLAG_LABEL[flag]}
                  </button>
                );
              })}
              {rsFlags.has('veg') && (
                <p className="text-[10px] text-gray-500 mt-1 leading-tight">
                  Surface-anomaly run is partial — ~5K of 131K wells analyzed.
                </p>
              )}
              {rsFlags.size > 0 && filters.includes('critical') && (
                <p className="text-[10px] text-red-400 mt-1 leading-tight">
                  Critical wells stay visible regardless of flag filters.
                </p>
              )}

              {/* Hard filter — visually separated from RS flags since it's a
                  status filter (not a remote-sensing signal) and AND's onto
                  every priority tier including critical. */}
              <div className="border-t border-white/10 mt-1 pt-1.5">
                <button
                  onClick={() => setOrphansOnly(prev => !prev)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                  style={{
                    backgroundColor: orphansOnly ? '#fb7185' : 'transparent',
                    color:           orphansOnly ? '#000'    : '#fb7185',
                    border:          '1px solid #fb7185',
                    opacity:         orphansOnly ? 1 : 0.5,
                  }}
                  title="Keep only wells whose operator_status is historic_owner or orphan_program (~50K of 131K)"
                >
                  <span>Orphans only</span>
                  <span className="text-[10px] opacity-70">
                    {orphansOnly ? '50K' : ''}
                  </span>
                </button>
              </div>
            </div>
          )}

          {wellsTab === 'land' && (
            <div className="flex flex-col gap-1">
              {landCoverFilter !== 'all' && (
                <button
                  onClick={resetLandCover}
                  className="self-end text-[10px] text-gray-400 hover:text-white -mb-0.5"
                  title="Show all land-cover classes"
                >
                  reset
                </button>
              )}
              <div className="grid grid-cols-2 gap-1">
                {LAND_COVER_CODES.map(code => {
                  const active = landCoverFilter === 'all' || landCoverFilter.has(code);
                  const color  = LAND_COVER_COLOR[code];
                  return (
                    <button
                      key={code}
                      onClick={() => toggleLandCover(code)}
                      className="px-1.5 py-1 rounded text-[11px] font-medium transition-opacity text-left capitalize truncate"
                      style={{
                        backgroundColor: active ? color : 'transparent',
                        color: active ? '#000' : color,
                        border: `1px solid ${color}`,
                        opacity: active ? 1 : 0.5,
                      }}
                      title={LAND_COVER_LABEL[code]}
                    >
                      {LAND_COVER_LABEL[code]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── LAYERS card — overlay toggles + county metric picker ────────── */}
        <div className="flex flex-col bg-black/70 rounded p-2 border border-white/10 w-52">
          <span className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Layers</span>

          {/* Counties — toggle on/off, expose metric picker only when on */}
          <button
            onClick={() => setShowCounties(prev => !prev)}
            className="flex items-center justify-between text-xs py-0.5"
            style={{ color: showCounties ? '#a78bfa' : '#9ca3af' }}
          >
            <span>Counties</span>
            <span>{showCounties ? '●' : '○'}</span>
          </button>
          {showCounties && (
            <div className="grid grid-cols-2 gap-1 mt-1 mb-2">
              {(Object.keys(COUNTY_METRIC_LABELS) as CountyMetric[]).map(m => {
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
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-opacity text-left truncate"
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
          )}

          {/* Water zones */}
          <button
            onClick={() => setShowWaterSources(prev => !prev)}
            className="flex items-center justify-between text-xs py-0.5"
            style={{ color: showWaterSources ? '#0891b2' : '#9ca3af' }}
          >
            <span>Water zones</span>
            <span>{showWaterSources ? '●' : '○'}</span>
          </button>
          {showWaterSources && !waterSourcesLoaded && (
            <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
          )}

          {/* CH4 plumes */}
          <button
            onClick={() => setShowPlumes(prev => !prev)}
            className="flex items-center justify-between text-xs py-0.5"
            style={{ color: showPlumes ? '#f59e0b' : '#9ca3af' }}
          >
            <span>CH₄ plumes</span>
            <span>{showPlumes ? '●' : '○'}</span>
          </button>
          {showPlumes && !plumesLoaded && (
            <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
          )}
          {showPlumes && plumesLoaded && (
            <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
              Dot size = flux (log scale)
            </p>
          )}
        </div>
      </div>

      {hoverInfo && (
        <div
          className="absolute pointer-events-none z-20 bg-gray-900/95 border border-gray-600 rounded px-3 py-2 text-xs shadow-lg"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y - 14 }}
        >
          <div className="font-mono text-gray-300 mb-1">{hoverInfo.api_no}</div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: PRIORITY_COLOR[hoverInfo.priority], fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {hoverInfo.priority}
            </span>
            {hoverInfo.risk_score != null && (
              <span className="text-gray-400 font-mono">{hoverInfo.risk_score.toFixed(1)}</span>
            )}
          </div>
          {colorMode !== 'priority' && (() => {
            const score = colorMode === 'emissions' ? hoverInfo.emissions_risk_score
                        : colorMode === 'vegetation' ? hoverInfo.vegetation_risk_score
                        : hoverInfo.terrain_risk_score;
            return (
              <div className="text-gray-400 mb-0.5">
                {COLOR_MODE_LABEL[colorMode]}: <span className="text-white font-mono">{score != null ? score.toFixed(0) : '—'}</span>
              </div>
            );
          })()}
          <div className="text-gray-400">{hoverInfo.county}</div>
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
      .select('api_no, lat, lng, priority, risk_score, land_cover, emissions_risk_score, vegetation_risk_score, terrain_risk_score, ch4_is_anomaly, ch4_signal_source, is_artificially_flat, veg_anomaly_detected, cluster_neighbor_count, operator_status')
      .in('priority', priorities)
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data) {
      if (!row.lat || !row.lng) continue;
      allFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: {
          api_no:                row.api_no,
          priority:              row.priority,
          risk_score:            row.risk_score,
          land_cover:            row.land_cover ?? null,
          emissions_risk_score:  row.emissions_risk_score ?? null,
          vegetation_risk_score: row.vegetation_risk_score ?? null,
          terrain_risk_score:    row.terrain_risk_score ?? null,
          ch4_is_anomaly:        row.ch4_is_anomaly ?? false,
          ch4_signal_source:     row.ch4_signal_source ?? '',
          is_artificially_flat:    row.is_artificially_flat ?? false,
          veg_anomaly_detected:    row.veg_anomaly_detected ?? false,
          cluster_neighbor_count:  row.cluster_neighbor_count ?? 0,
          operator_status:         row.operator_status ?? '',
          county:                  '',
        },
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
    emissions_risk_score:     data.emissions_risk_score ?? null,
    vegetation_risk_score:    data.vegetation_risk_score ?? null,
    terrain_risk_score:       data.terrain_risk_score ?? null,
    composite_risk_score:     data.composite_risk_score ?? null,
    nearest_water_distance_m: data.nearest_water_distance_m,
    within_protection_zone:   data.within_protection_zone,
    operator_status:          data.operator_status,
    population_within_1km:    data.population_within_1km,
    population_within_5km:    data.population_within_5km,
    years_inactive:           data.years_inactive,
    land_cover:               data.land_cover ?? null,
    ch4_is_anomaly:           data.ch4_is_anomaly ?? null,
    ch4_signal_source:        data.ch4_signal_source ?? null,
    ch4_well_ppb:             data.ch4_well_ppb ?? null,
    ch4_background_ppb:       data.ch4_background_ppb ?? null,
    ch4_anomaly_ratio:        data.ch4_anomaly_ratio ?? null,
    thermal_anomaly_c:        data.thermal_anomaly_c ?? null,
    is_artificially_flat:     data.is_artificially_flat ?? null,
    slope_ratio:              data.slope_ratio ?? null,
    veg_anomaly_detected:     data.veg_anomaly_detected ?? null,
    veg_anomaly_type:         data.veg_anomaly_type ?? null,
    ndvi_relative:            data.ndvi_relative ?? null,
    ndvi_trend_slope:         data.ndvi_trend_slope ?? null,
    cluster_neighbor_count:   data.cluster_neighbor_count ?? null,
    last_nonzero_production_year: data.last_nonzero_production_year ?? null,
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

async function loadPlumes(m: mapboxgl.Map): Promise<boolean> {
  try {
    const res = await fetch('/api/methane-plumes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('methane-plumes') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[methane-plumes]', err);
    return false;
  }
}
