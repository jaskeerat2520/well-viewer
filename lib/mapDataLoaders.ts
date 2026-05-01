import type mapboxgl from 'mapbox-gl';
import { supabase } from '@/lib/supabase';
import type { Priority, WellDetail } from '@/lib/types';
import type { ActivityLevel } from '@/lib/mapExpressions';

// ────────────────────────────────────────────────────────────────────────
// Activity classification
//
// Used at well-load time to bake an `activity` property onto every well
// feature; the wells layer then filters on it without needing a join.
// ────────────────────────────────────────────────────────────────────────

export function classifyActivity(
  status: string | null,
  lastProd: number | null,
): ActivityLevel {
  if (status === 'Producing') {
    if (lastProd == null) return 'paperwork';
    if (lastProd >= 2020) return 'active';
    if (lastProd >= 2015) return 'aging';
    return 'zombie';
  }
  return 'other';
}

// ────────────────────────────────────────────────────────────────────────
// Wells loader
//
// Fetches one priority group at a time from the flat well_map_view, merges
// into a shared accumulator, and pushes incremental updates to the Mapbox
// source so the user sees critical dots before the rest of the data lands.
// ────────────────────────────────────────────────────────────────────────

export async function loadWells(
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
      .select('api_no, lat, lng, priority, risk_score, land_cover, emissions_risk_score, vegetation_risk_score, terrain_risk_score, ch4_is_anomaly, ch4_signal_source, is_artificially_flat, veg_anomaly_detected, cluster_neighbor_count, operator_status, admin_status, status, last_nonzero_production_year')
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
          admin_status:            row.admin_status ?? '',
          activity:                classifyActivity(row.status ?? null, row.last_nonzero_production_year ?? null),
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

// ────────────────────────────────────────────────────────────────────────
// Overlay loaders — each lazy-fetches a GeoJSON FeatureCollection from a
// Next API route and pushes it into the corresponding Mapbox source. They
// return a boolean for the caller to flip the *Loaded flag in the store.
// ────────────────────────────────────────────────────────────────────────

export async function loadWaterSources(m: mapboxgl.Map): Promise<boolean> {
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

// USGS NHD small-scale rivers + lakes. Single API call → one GeoJSON
// FeatureCollection containing both feature_types; the map layers filter
// on `feature_type` so flowlines render as lines and waterbodies as fills.
export async function loadHydrography(m: mapboxgl.Map): Promise<boolean> {
  try {
    const res = await fetch('/api/hydrography');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('hydrography') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[hydrography]', err);
    return false;
  }
}

export async function loadParcelsByBbox(m: mapboxgl.Map): Promise<boolean> {
  try {
    const b = m.getBounds();
    if (!b) return false;
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    const res = await fetch(`/api/parcels?bbox=${encodeURIComponent(bbox)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('parcels') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[parcels:bbox]', err);
    return false;
  }
}

export async function loadParcelsByCounty(m: mapboxgl.Map, county: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/parcels?county=${encodeURIComponent(county)}&limit=100000`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('parcels') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[parcels:county]', err);
    return false;
  }
}

export async function loadPlumes(m: mapboxgl.Map): Promise<boolean> {
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

export async function loadPadCandidates(m: mapboxgl.Map): Promise<boolean> {
  try {
    const res = await fetch('/api/pad-candidates');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('pad-candidates') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[pad-candidates]', err);
    return false;
  }
}

export async function loadSchools(m: mapboxgl.Map): Promise<boolean> {
  try {
    const res = await fetch('/api/schools');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('schools') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[schools]', err);
    return false;
  }
}

export async function loadHospitals(m: mapboxgl.Map): Promise<boolean> {
  try {
    const res = await fetch('/api/hospitals');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('hospitals') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[hospitals]', err);
    return false;
  }
}

export async function loadSpills(
  m: mapboxgl.Map,
  oilGasOnly: boolean = false,
): Promise<boolean> {
  try {
    const url = oilGasOnly ? '/api/spills?oilgas=1' : '/api/spills';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson: GeoJSON.FeatureCollection = await res.json();
    (m.getSource('oepa-spills') as mapboxgl.GeoJSONSource)?.setData(geojson);
    return true;
  } catch (err) {
    console.error('[spills]', err);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ────────────────────────────────────────────────────────────────────────

export function getGeometryBounds(geometry: GeoJSON.Geometry): mapboxgl.LngLatBoundsLike | null {
  const coords: number[][] = [];
  if (geometry.type === 'Polygon') {
    geometry.coordinates[0].forEach((c) => coords.push(c));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((poly) => poly[0].forEach((c) => coords.push(c)));
  }
  if (!coords.length) return null;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

// ────────────────────────────────────────────────────────────────────────
// Single-well detail fetch (clicked dot → sidebar)
// ────────────────────────────────────────────────────────────────────────

export async function fetchWellDetail(api_no: string): Promise<WellDetail | null> {
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
