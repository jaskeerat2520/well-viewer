import { useEffect, type RefObject } from 'react';
import mapboxgl from 'mapbox-gl';

// Set token once at module load — runs before any consumer instantiates a map.
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

import { supabase } from '@/lib/supabase';
import { loadCachedWells, saveCachedWells } from '@/lib/wellsCache';
import { ensurePmtilesProtocol } from '@/lib/pmtilesProtocol';
import {
  Priority,
  PRIORITY_COLOR,
  CountySummary,
  WATER_SOURCE_COLOR,
  WellDetail,
  LandCoverCode,
  LAND_COVER_LABEL,
} from '@/lib/types';
import {
  PARCEL_FILL_COLOR_EXPR,
  LAND_USE_LABEL,
  HAZARD_FLAG_COLOR,
  HAZARD_FLAG_LABEL,
} from '@/lib/mapExpressions';
import {
  loadWells,
  fetchWellDetail,
  getGeometryBounds,
} from '@/lib/mapDataLoaders';
import { useMapStore } from '@/lib/mapStore';

const PARCELS_PMTILES_URL = process.env.NEXT_PUBLIC_PARCELS_PMTILES_URL;
const PARCELS_USE_PMTILES = !!PARCELS_PMTILES_URL;

// PA DEP oil & gas locations vector tileset (Mapbox-hosted via MTS). The
// wells table already has PA rows ingested from the same source, so this
// overlay exists for cross-checking provenance, not primary triage.
const PA_OILGAS_TILESET =
  process.env.NEXT_PUBLIC_PA_OILGAS_TILESET || 'jas2520.pa-oilgas-locations-2026-04';

// Mapbox setHTML does not sanitize. Any string field that originates outside
// our trust boundary (DB rows, third-party APIs) must pass through this before
// being interpolated into popup HTML.
function escapeHtml(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// AML/AMLIS program-area code → human-readable label. Codes come from OSMRE
// problem-type taxonomy as used by Ohio DMRM. Show the code if unrecognized.
const AML_PROGAREA_LABEL: Record<string, string> = {
  SGA: 'Subsidence / Generated Acid',
  SEA: 'Surface / Erosion / Subsidence',
  AMA: 'Acid Mine Abatement',
  CLA: 'Coal Leach Area',
  PSP: 'Physical Subsidence Program',
};

type PopupAttrs = Record<string, string | number | null>;

// Mapbox preserves nested objects on GeoJSON sources, but a future migration
// to vector tiles would stringify them. Guard against both shapes.
function safeAttrs(raw: unknown): PopupAttrs {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as PopupAttrs; } catch { return {}; }
  }
  if (typeof raw === 'object') return raw as PopupAttrs;
  return {};
}

// Layer-type-aware popup body. Floodplain shows FEMA zone classification;
// AML projects show project number + program area + AMLIS cross-reference.
// Other layers fall back to the simple name + area popup.
function hazardPopupHtml(props: Record<string, unknown>): string {
  const layerType = String(props.layer_type ?? '');
  const name      = escapeHtml(props.name);
  const area      = Number(props.area_km2);
  const areaLine  = isFinite(area) && area > 0
    ? `<div style="color:#9ca3af">Area: <span style="color:#fff">${area.toFixed(2)} km²</span></div>` : '';
  const attrs = safeAttrs(props.attrs);

  const layerLabelMap: Record<string, string> = {
    aum_mine:         'Abandoned underground mine',
    dogrm_urban_area: 'DOGRM regulatory urban area',
  };
  const layerLabel = layerLabelMap[layerType] ?? layerType;

  // Default: simple name + area for AUM mines and DOGRM urban
  return `
    <div style="font-size:12px">
      <div style="font-weight:600;margin-bottom:4px;color:#fff">${name || layerLabel}</div>
      <div style="color:#9ca3af">Layer: <span style="color:#fff">${escapeHtml(layerType)}</span></div>
      ${areaLine}
      <div style="color:#6b7280;margin-top:4px;font-size:10px">gis.ohiodnr.gov</div>
    </div>
  `;
}

// Owns the imperative Mapbox lifecycle: map creation, all source/layer
// registration, click/hover handlers, and the 3-phase initial wells load.
//
// Why one hook instead of one-per-layer: every `addLayer` call is z-order
// sensitive (later additions render on top). Splitting registration across
// multiple hooks would create a fragile ordering coupling — if useWellLayers
// fired before useSatelliteLayers, the satellite would draw OVER the wells.
// Keeping the whole stack registration here preserves the original ordering
// guarantee trivially.
export function useMapInit(
  mapContainer: RefObject<HTMLDivElement | null>,
  mapRef: RefObject<mapboxgl.Map | null>,
  onSelectWell: (well: WellDetail | null) => void,
  onSelectCounty: (county: CountySummary | null) => void,
) {
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // Pull store actions inside the effect so the closure binds the stable
    // setters once. Zustand actions are referentially stable across renders.
    const { setHoverInfo, setLoadStatus } = useMapStore.getState();

    // Must run before any map source uses the pmtiles:// scheme. Idempotent.
    if (PARCELS_USE_PMTILES) ensurePmtilesProtocol();

    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-82.8, 40.4], // Center of Ohio
      zoom: 6.5,
    });

    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    mapRef.current.on('load', async () => {
      const m = mapRef.current!;

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
      // Ohio OSIP — most-current statewide aerial mosaic (mix of 6-inch and 1ft
      // depending on the cycle each county was last flown). Served as a fused
      // map cache in Web Mercator, so it slots straight in as a Mapbox raster source.
      m.addSource('osip-satellite', {
        type: 'raster',
        tiles: ['https://maps.ohio.gov/image/rest/services/osip_most_current_cache/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Ohio OIT / OGRIP — Ohio Statewide Imagery Program (OSIP)',
        minzoom: 7, // cache only covers Ohio; lower zooms would 404
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
        emissionsRows?.map((r) => [r.county, { annual_co2e_mt: Number(r.annual_co2e_mt), cars_equivalent: r.cars_equivalent }]) ?? [],
      );

      if (countyRows && countyRows.length > 0) {
        const countyFeatures: GeoJSON.Feature[] = countyRows
          .filter((row) => row.geojson)
          .map((row) => ({
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
            'fill-color': 'rgba(0,0,0,0)',
            'fill-opacity': 0,
          },
        });

        m.addLayer({
          id: 'counties-line',
          type: 'line',
          source: 'counties',
          paint: {
            'line-color': '#64748b',
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 0.65],
            'line-width':   ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.5],
          },
        });

        // Highlight outline for the currently selected county. Filter starts
        // matching nothing (sentinel fips); the selectedCounty effect swaps
        // the filter when the user picks a county.
        // Glow layer (rendered first, sits below the crisp line)
        m.addLayer({
          id: 'counties-selected-glow',
          type: 'line',
          source: 'counties',
          filter: ['==', 'fips_code', '__none__'],
          paint: {
            'line-color': '#facc15',
            'line-opacity': 0.45,
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 10, 12, 14, 18],
            'line-blur': 6,
          },
        });
        m.addLayer({
          id: 'counties-selected-outline',
          type: 'line',
          source: 'counties',
          filter: ['==', 'fips_code', '__none__'],
          paint: {
            'line-color': '#facc15',
            'line-opacity': 1,
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 4, 14, 5],
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
          const priorityLayerIds = ['methane-plumes-dot', 'oepa-spills-dot', 'schools-dot', 'hospitals-dot', 'tri-facilities-dot', 'pa-oilgas-dot', 'pad-candidates-dot', 'wells-critical', 'wells-high', 'wells-medium', 'wells-low', 'parcels-fill'];
          const presentPriorityLayers = priorityLayerIds.filter(id => !!m.getLayer(id));
          const topHits = presentPriorityLayers.length > 0
            ? m.queryRenderedFeatures(e.point, { layers: presentPriorityLayers })
            : [];
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

      // ── USGS NHD hydrography (rivers + lakes) ────────────────────────────
      // Stored in `hydrography` table. One source, one Feature collection;
      // the layers below filter on `feature_type` so we paint lines for
      // flowlines and fills for waterbodies. This is the *visible* surface
      // water layer — distinct from `water-sources-*` which is the SWAP
      // regulatory zones.
      m.addSource('hydrography', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Lakes / reservoirs / ponds — fill below the line so the river
      // entering the lake doesn't visually "cut" the lake outline.
      m.addLayer({
        id: 'hydrography-waterbodies-fill',
        type: 'fill',
        source: 'hydrography',
        filter: ['==', ['get', 'feature_type'], 'waterbody'],
        layout: { visibility: 'none' },
        paint: {
          'fill-color': '#3b82f6',           // blue-500
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.30, 10, 0.55],
        },
      });
      m.addLayer({
        id: 'hydrography-waterbodies-outline',
        type: 'line',
        source: 'hydrography',
        filter: ['==', ['get', 'feature_type'], 'waterbody'],
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#1d4ed8',           // blue-700
          'line-opacity': 0.8,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.2],
        },
      });

      // Streams / rivers. Width ramps with zoom; named perennials get a
      // small visual bump so the Ohio + Scioto + Muskingum read first at
      // low zoom without manually filtering the layer.
      m.addLayer({
        id: 'hydrography-flowlines',
        type: 'line',
        source: 'hydrography',
        filter: ['==', ['get', 'feature_type'], 'flowline'],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#60a5fa',           // blue-400
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.55, 10, 0.85],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            5, ['case', ['has', 'gnis_name'], 0.6, 0.3],
            9, ['case', ['has', 'gnis_name'], 1.4, 0.7],
            13, ['case', ['has', 'gnis_name'], 2.6, 1.4],
          ],
        },
      });

      m.on('click', 'hydrography-waterbodies-fill', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const area = Number(props.area_km2);
        new mapboxgl.Popup({ maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px;color:#fff">${escapeHtml(props.gnis_name) || 'Unnamed waterbody'}</div>
              <div style="color:#9ca3af">Type: <span style="color:#fff">${escapeHtml(props.ftype) || '—'}</span></div>
              ${isFinite(area) && area > 0 ? `<div style="color:#9ca3af">Area: <span style="color:#fff">${area.toFixed(2)} km²</span></div>` : ''}
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('click', 'hydrography-flowlines', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        new mapboxgl.Popup({ maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px;color:#fff">${escapeHtml(props.gnis_name) || 'Unnamed stream'}</div>
              <div style="color:#9ca3af">Type: <span style="color:#fff">${escapeHtml(props.ftype) || '—'}</span></div>
              ${props.stream_order != null ? `<div style="color:#9ca3af">Stream order: <span style="color:#fff">${props.stream_order}</span></div>` : ''}
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'hydrography-waterbodies-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'hydrography-waterbodies-fill', () => { m.getCanvas().style.cursor = ''; });
      m.on('mouseenter', 'hydrography-flowlines', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'hydrography-flowlines', () => { m.getCanvas().style.cursor = ''; });

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

      // ── OEPA reported spills (current year) ──────────────────────────────
      // Front-end-only context; not part of the composite score. Two-color
      // ramp: red for oil/gas-typed releases, amber for everything else.
      m.addSource('oepa-spills', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: 'oepa-spills-glow',
        type: 'circle',
        source: 'oepa-spills',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': ['case', ['get', 'is_oil_gas'], '#dc2626', '#fbbf24'],
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5,  10,
            9,  20,
            13, 32,
          ],
          'circle-opacity': 0.22,
          'circle-blur': 1.2,
        },
      });

      m.addLayer({
        id: 'oepa-spills-dot',
        type: 'circle',
        source: 'oepa-spills',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': ['case', ['get', 'is_oil_gas'], '#dc2626', '#fbbf24'],
          // Oil/gas dots get a flat-larger radius so they read first against
          // the much larger amber background.
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5,  ['case', ['get', 'is_oil_gas'], 5, 3],
            10, ['case', ['get', 'is_oil_gas'], 9, 6],
            13, ['case', ['get', 'is_oil_gas'], 13, 9],
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#000',
          'circle-opacity': 0.95,
        },
      });

      m.on('click', 'oepa-spills-dot', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const product = (props.reported_product as string | null) ?? '—';
        const date = props.reported_date
          ? String(props.reported_date).slice(0, 10)
          : '—';
        const amt = props.reported_amount;
        const uom = props.reported_uom;
        const amountText =
          amt != null && Number(amt) > 0 && uom
            ? `${Number(amt)} ${uom}`
            : amt != null && Number(amt) > 0
              ? String(amt)
              : 'unknown';
        const place = [props.city_township, props.county].filter(Boolean).join(' · ');
        const waterway = props.waterway
          ? `<div style="color:#9ca3af">Waterway: <span style="color:#fff">${props.waterway}</span></div>`
          : '';
        const tag = props.is_oil_gas
          ? '<span style="background:#dc2626;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:6px">OIL/GAS</span>'
          : '';
        new mapboxgl.Popup({ maxWidth: '300px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px">
                OEPA spill ${tag}
              </div>
              <div style="color:#9ca3af">Case: <span style="color:#fff">${props.case_number ?? '—'}</span></div>
              <div style="color:#9ca3af">Product: <span style="color:#fff">${product}</span></div>
              <div style="color:#9ca3af">Reported: <span style="color:#fff">${amountText}</span></div>
              <div style="color:#9ca3af">Date: <span style="color:#fff">${date}</span></div>
              ${place ? `<div style="color:#9ca3af">Where: <span style="color:#fff">${place}</span></div>` : ''}
              ${waterway}
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'oepa-spills-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'oepa-spills-dot', () => { m.getCanvas().style.cursor = ''; });

      // ── Ohio public schools (ODE 2021-2022 layer) ────────────────────────
      // Front-end-only context for "wells near schools" framing. Distance to
      // nearest school is computed in score_schools.py but does not feed the
      // composite (Tier 1 informational).
      m.addSource('schools', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: 'schools-dot',
        type: 'circle',
        source: 'schools',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#a855f7',
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            6,  3,
            10, 5,
            14, 8,
          ],
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#1e1b4b',
          'circle-opacity': 0.95,
        },
      });

      m.on('click', 'schools-dot', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        new mapboxgl.Popup({ maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px;color:#fff">${escapeHtml(props.name) || 'Unnamed school'}</div>
              <div style="color:#9ca3af">District: <span style="color:#fff">${escapeHtml(props.district) || '—'}</span></div>
              <div style="color:#9ca3af">Type: <span style="color:#fff">${escapeHtml(props.school_type) || '—'}</span></div>
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'schools-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'schools-dot', () => { m.getCanvas().style.cursor = ''; });

      // ── Ohio hospitals (ODH Hospital Registration 2023, geocoded via Census) ──
      // Front-end-only context for "wells near hospitals" framing. Distance to
      // nearest hospital is computed in score_hospitals.py but does not feed the
      // composite (Tier 1 informational).
      m.addSource('hospitals', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: 'hospitals-dot',
        type: 'circle',
        source: 'hospitals',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#ec4899',  // pink-500: medical-adjacent, distinct from schools purple and spills red
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            6,  4,
            10, 7,
            14, 11,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#831843',  // pink-900 ring
          'circle-opacity': 0.95,
        },
      });

      m.on('click', 'hospitals-dot', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const traumaA = escapeHtml(props.trauma_level_adult);
        const traumaP = escapeHtml(props.trauma_level_pediatric);
        const traumaLine = (traumaA && traumaA !== 'Not available') || (traumaP && traumaP !== 'Not available')
          ? `<div style="color:#9ca3af">Trauma: <span style="color:#fff">Adult ${traumaA || '—'} · Pediatric ${traumaP || '—'}</span></div>`
          : '';
        new mapboxgl.Popup({ maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px;color:#fff">${escapeHtml(props.name) || 'Unnamed hospital'}</div>
              <div style="color:#9ca3af">Type: <span style="color:#fff">${escapeHtml(props.medicare_classification) || escapeHtml(props.service_category) || '—'}</span></div>
              <div style="color:#9ca3af">Location: <span style="color:#fff">${escapeHtml(props.city) || '—'}, ${escapeHtml(props.county) || '—'}</span></div>
              ${traumaLine}
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'hospitals-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'hospitals-dot', () => { m.getCanvas().style.cursor = ''; });

      // ── ODNR hazard overlays (AUM mines, DOGRM urban) ──
      // One source, four fill+outline layer pairs filtered by `layer_type`.
      // Tier 1 informational — these polygons make the same hazards that the
      // Hazards filter tab toggles visible on the map itself, so a user can
      // both narrow the dot set AND see the polygon footprint at the same time.
      m.addSource('odnr-hazards', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      type HazardKey = 'aum_mine' | 'dogrm_urban_area';
      const hazardLayerSpecs: { key: HazardKey; filter: mapboxgl.Expression; color: string; opacity: number; label: string }[] = [
        { key: 'aum_mine',         filter: ['==', ['get', 'layer_type'], 'aum_mine'],         color: HAZARD_FLAG_COLOR.aum_subsidence, opacity: 0.22, label: HAZARD_FLAG_LABEL.aum_subsidence },
        { key: 'dogrm_urban_area', filter: ['==', ['get', 'layer_type'], 'dogrm_urban_area'], color: HAZARD_FLAG_COLOR.dogrm_urban,    opacity: 0.10, label: HAZARD_FLAG_LABEL.dogrm_urban    },
      ];

      for (const spec of hazardLayerSpecs) {
        m.addLayer({
          id: `odnr-hazards-${spec.key}-fill`,
          type: 'fill',
          source: 'odnr-hazards',
          filter: spec.filter,
          minzoom: 6,
          layout: { visibility: 'none' },
          paint: { 'fill-color': spec.color, 'fill-opacity': spec.opacity },
        });
        m.addLayer({
          id: `odnr-hazards-${spec.key}-outline`,
          type: 'line',
          source: 'odnr-hazards',
          filter: spec.filter,
          minzoom: 6,
          layout: { visibility: 'none' },
          paint: { 'line-color': spec.color, 'line-opacity': 0.65, 'line-width': 0.9 },
        });

        // Click → layer-type-aware popup. Floodplain shows FEMA zone code +
        // floodway flag; AML projects show project number + program area +
        // AMLIS federal cross-reference key. See hazardPopupHtml() above.
        const fillLayerId = `odnr-hazards-${spec.key}-fill`;
        m.on('click', fillLayerId, (e) => {
          const props = e.features?.[0]?.properties;
          if (!props) return;
          new mapboxgl.Popup({ maxWidth: '300px' })
            .setLngLat(e.lngLat)
            .setHTML(hazardPopupHtml(props))
            .addTo(m);
          e.originalEvent.stopPropagation();
        });
        m.on('mouseenter', fillLayerId, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', fillLayerId, () => { m.getCanvas().style.cursor = ''; });
      }

      // ── PA DEP Oil & Gas Locations (Mapbox MTS vector tileset) ───────────
      // Independent feed from the `wells` table's PA rows; useful for
      // cross-checking permit/operator/status against PA DEP's published
      // record. CDN-served, no Supabase round-trip.
      m.addSource('pa-oilgas', {
        type: 'vector',
        url: `mapbox://${PA_OILGAS_TILESET}`,
      });

      m.addLayer({
        id: 'pa-oilgas-dot',
        type: 'circle',
        source: 'pa-oilgas',
        'source-layer': 'pa_oilgas',
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#10b981',  // emerald-500: distinct from priority red/orange/yellow and from amber annual_co2e_mt metric
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            4,  1.2,
            8,  2.5,
            12, 4,
            14, 6,
          ],
          'circle-stroke-width': 0.6,
          'circle-stroke-color': '#064e3b',  // emerald-950 ring for contrast on light basemaps
          'circle-opacity': 0.85,
        },
      });

      m.on('click', 'pa-oilgas-dot', (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const fmtMs = (ms: unknown) => {
          if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
          // Source DBF stores epoch ms (incl. negatives for pre-1970 wells).
          return new Date(ms).toISOString().slice(0, 10);
        };
        new mapboxgl.Popup({ maxWidth: '300px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px;color:#fff">${escapeHtml(props.well_name) || 'Unnamed'} <span style="color:#9ca3af;font-weight:400">· ${escapeHtml(props.permit_num) || '—'}</span></div>
              <div style="color:#9ca3af">Operator: <span style="color:#fff">${escapeHtml(props.operator) || '—'}</span></div>
              <div style="color:#9ca3af">Type / status: <span style="color:#fff">${escapeHtml(props.well_type) || '—'} · ${escapeHtml(props.well_status) || '—'}</span></div>
              <div style="color:#9ca3af">Location: <span style="color:#fff">${escapeHtml(props.municipality) || '—'}, ${escapeHtml(props.county) || '—'} County</span></div>
              <div style="color:#9ca3af">Unconventional: <span style="color:#fff">${props.unconventional === 'Y' ? 'Yes' : props.unconventional === 'N' ? 'No' : '—'}</span></div>
              <div style="color:#9ca3af">Spud / plug: <span style="color:#fff">${fmtMs(props.spud_date_ms)} · ${fmtMs(props.plug_date_ms)}</span></div>
              <div style="color:#6b7280;margin-top:4px;font-size:10px">Source: PA DEP Oil &amp; Gas Locations 2026-04</div>
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'pa-oilgas-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'pa-oilgas-dot', () => { m.getCanvas().style.cursor = ''; });

      // ── Surface parcels ─────────────────────────────────────────────────
      // Two delivery modes, switched by NEXT_PUBLIC_PARCELS_PMTILES_URL:
      //   * Vector tiles (PMTiles) — preferred. Statewide visibility from
      //     zoom 6, no per-move refetch, recolored by land-use class with
      //     SORP/state-owned override painted as ODNR green.
      //   * Legacy GeoJSON — kept as a fallback for builds where the bake
      //     hasn't been uploaded yet. Bbox-loaded, zoom-9 gated, flat yellow.
      if (PARCELS_USE_PMTILES) {
        m.addSource('parcels', {
          type: 'vector',
          url: `pmtiles://${PARCELS_PMTILES_URL}`,
          minzoom: 6,
          maxzoom: 14,
        });

        m.addLayer({
          id: 'parcels-fill',
          type: 'fill',
          source: 'parcels',
          'source-layer': 'parcels',
          minzoom: 6,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': PARCEL_FILL_COLOR_EXPR,
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.10, 10, 0.20, 14, 0.30],
          },
        });

        m.addLayer({
          id: 'parcels-outline',
          type: 'line',
          source: 'parcels',
          'source-layer': 'parcels',
          minzoom: 9,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#525252',
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.10, 14, 0.55],
            'line-width':   ['interpolate', ['linear'], ['zoom'], 9, 0.25, 14, 1.0],
          },
        });
      } else {
        m.addSource('parcels', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        m.addLayer({
          id: 'parcels-fill',
          type: 'fill',
          source: 'parcels',
          minzoom: 9,
          layout: { visibility: 'none' },
          paint: { 'fill-color': '#facc15', 'fill-opacity': 0.10 },
        });

        m.addLayer({
          id: 'parcels-outline',
          type: 'line',
          source: 'parcels',
          minzoom: 9,
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#facc15',
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.35, 14, 0.75],
            'line-width':   ['interpolate', ['linear'], ['zoom'], 9, 0.4,  14, 1.2],
          },
        });
      }

      m.on('click', 'parcels-fill', (e) => {
        // Defer to higher-priority features (wells, plumes, schools, hospitals,
        // spills) at the same point.
        const topHits = m.queryRenderedFeatures(e.point, {
          layers: ['methane-plumes-dot', 'oepa-spills-dot', 'schools-dot', 'hospitals-dot', 'wells-critical', 'wells-high', 'wells-medium', 'wells-low'],
        });
        if (topHits.length > 0) return;
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const acres = props.acreage != null ? Number(props.acreage).toFixed(2) : '—';
        // Vector-tile booleans deserialize as 0/1 sometimes — coerce.
        const stateOwned = props.is_state_owned === true || props.is_state_owned === 'true' || props.is_state_owned === 1;
        const luClass = typeof props.land_use_class === 'string' ? props.land_use_class : null;
        const luLabel = luClass ? (LAND_USE_LABEL[luClass] ?? luClass) : null;
        new mapboxgl.Popup({ maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px">${props.owner_name ?? 'Unknown owner'}</div>
              ${stateOwned ? `<div style="color:#16a34a;margin-bottom:3px">⬢ State land${props.state_agency ? ` · ${props.state_agency}` : ''}</div>` : ''}
              <div style="color:#9ca3af">Parcel: <span style="color:#fff;font-family:monospace">${props.parcel_id ?? '—'}</span></div>
              <div style="color:#9ca3af">Acreage: <span style="color:#fff">${acres}</span></div>
              <div style="color:#9ca3af">County: <span style="color:#fff">${props.county ?? '—'}</span></div>
              ${luLabel ? `<div style="color:#9ca3af">Land use: <span style="color:#fff">${luLabel}${luClass === 'other' && props.land_use_code ? ` (${props.land_use_code})` : ''}</span></div>` : ''}
            </div>
          `)
          .addTo(m);
        e.originalEvent.stopPropagation();
      });
      m.on('mouseenter', 'parcels-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'parcels-fill', () => { m.getCanvas().style.cursor = ''; });

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

      // Clicking blank map clears both selections.
      // Guard: if the click landed on a county fill or a well dot, the layer-
      // specific handlers have already (or will) handle the selection — don't
      // clear here. County handlers are synchronous so a naive clear would win;
      // well handlers are async so they already survived the race, but skipping
      // the clear also eliminates the brief sidebar-close flash on well clicks.
      m.on('click', (e) => {
        const candidateLayers = ['counties-fill', 'wells-critical', 'wells-high', 'wells-medium', 'wells-low'];
        const presentLayers = candidateLayers.filter(id => !!m.getLayer(id));
        if (presentLayers.length > 0) {
          const hits = m.queryRenderedFeatures(e.point, { layers: presentLayers });
          if (hits.length > 0) return;
        }
        onSelectWell(null);
        onSelectCounty(null);
      });

      // Try the persistent cache first — survives navigation and hard reload.
      // On hit, paint everything in one go. On miss, fall through to the
      // 3-phase fetch and persist the union at the end.
      const cached = await loadCachedWells();
      if (cached && cached.length > 0) {
        const source = m.getSource('wells') as mapboxgl.GeoJSONSource | undefined;
        if (source) source.setData({ type: 'FeatureCollection', features: cached });
        setLoadStatus('');
      } else {
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
        await saveCachedWells(allFeatures);
      }
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
