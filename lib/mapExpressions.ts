import type mapboxgl from 'mapbox-gl';
import type { Priority, LandCoverCode } from '@/lib/types';

// ────────────────────────────────────────────────────────────────────────
// Map-internal types
//
// These describe the enum values that index the constant tables below. Kept
// here (rather than lib/types.ts) because they're meaningful only inside the
// map UI — the rest of the app deals in Priority/AdminStatus.
// ────────────────────────────────────────────────────────────────────────

export type ColorMode = 'priority' | 'emissions' | 'vegetation' | 'terrain';

export type RsFlag = 'ch4' | 'plume' | 'veg' | 'flat' | 'cluster';

// ODNR hazard overlays — regulator-mapped polygons (mine subsidence, AML
// reclamation, state floodplain, DOGRM urban). Distinct from RS flags because
// they're hard ground-truth from gov't sources, not observational signals;
// they apply as hard filters to every priority tier including critical.
export type HazardFlag = 'aum_subsidence' | 'dogrm_urban';

// Distance bucket for nearest mapped abandoned-mine opening.
export type AumOpeningDistance = 'any' | 'under_500' | 'under_1km' | 'under_5km';

// Distance bucket for nearest active TRI (Toxic Release Inventory) facility.
// Same value space as AumOpeningDistance — defining as a separate type so
// future divergence (e.g. an "≤ 10km" bucket only here) doesn't break.
export type TriDistance = 'any' | 'under_500' | 'under_1km' | 'under_5km';

export type WellsTab = 'priority' | 'activity' | 'color' | 'flags' | 'hazards' | 'land';

export type ActivityLevel = 'active' | 'aging' | 'zombie' | 'paperwork' | 'other';

export type CountyMetric =
  | 'avg_risk_score'
  | 'critical_count'
  | 'high_count'
  | 'medium_count'
  | 'low_count'
  | 'annual_co2e_mt';

export type SatelliteMode = 'off' | 'bing' | 'esri' | 'mapbox' | 'osip';

// Floating tooltip shown next to the cursor while hovering a well dot. The
// scores are duplicated from the well feature's properties so the tooltip can
// render the right RS dimension without re-querying the source on every move.
export interface HoverInfo {
  x: number;
  y: number;
  priority: Priority;
  risk_score: number | null;
  api_no: string;
  county: string;
  emissions_risk_score: number | null;
  vegetation_risk_score: number | null;
  terrain_risk_score: number | null;
}

export const ACTIVITY_LEVELS: ActivityLevel[] = ['active', 'aging', 'zombie', 'paperwork', 'other'];

export const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low'];

// Full set of WorldCover codes we classify in score_land_cover.py. If every
// code is selected (or the user toggled "all"), we skip the land-cover filter
// expression entirely so wells with a NULL land_cover stay visible too.
export const LAND_COVER_CODES: LandCoverCode[] = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];

// ────────────────────────────────────────────────────────────────────────
// Parcel land-use palette
//
// Land-use classes are derived at bake time from Ohio CAUV first-digit codes.
// State-owned (SORP overlay) wins over land-use, painted as ODNR green.
// ────────────────────────────────────────────────────────────────────────

export const PARCEL_FILL_COLOR_EXPR: mapboxgl.Expression = [
  'case',
  ['==', ['get', 'is_state_owned'], true],          '#16a34a',
  ['==', ['get', 'land_use_class'], 'agriculture'], '#fde68a',
  ['==', ['get', 'land_use_class'], 'forest'],      '#86efac',
  ['==', ['get', 'land_use_class'], 'residential'], '#fdba74',
  ['==', ['get', 'land_use_class'], 'commercial'],  '#f87171',
  ['==', ['get', 'land_use_class'], 'industrial'],  '#c4b5fd',
  ['==', ['get', 'land_use_class'], 'public'],      '#93c5fd',
  ['==', ['get', 'land_use_class'], 'vacant'],      '#e7e5e4',
  /* default (incl. 'unknown' / 'other') */         '#d4d4d8',
];

export const LAND_USE_LABEL: Record<string, string> = {
  agriculture: 'Agricultural',
  forest:      'Forest / conservation',
  residential: 'Residential',
  commercial:  'Commercial',
  industrial:  'Industrial / utility',
  public:      'Public / exempt',
  vacant:      'Vacant',
  unknown:     'Unknown',
  other:       'Other',
};

// ────────────────────────────────────────────────────────────────────────
// Color-mode (well-dot recolor by RS dimension)
// ────────────────────────────────────────────────────────────────────────

export const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  priority:   'Priority',
  emissions:  'Emissions',
  vegetation: 'Vegetation',
  terrain:    'Terrain',
};

export const COLOR_MODE_SCORE_FIELD: Record<Exclude<ColorMode, 'priority'>, string> = {
  emissions:  'emissions_risk_score',
  vegetation: 'vegetation_risk_score',
  terrain:    'terrain_risk_score',
};

export function rsScoreColorExpr(field: string): mapboxgl.Expression {
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

// ────────────────────────────────────────────────────────────────────────
// Remote-sensing flag filters (CH4 / plume / veg / flat / cluster)
// ────────────────────────────────────────────────────────────────────────

export const RS_FLAG_LABEL: Record<RsFlag, string> = {
  ch4:     'CH₄ anomaly',
  plume:   'Near plume',
  veg:     'Vegetation loss',
  flat:    'Artificially flat',
  cluster: 'Clustered (≥2 neighbors 33–100 ft)',
};

export const RS_FLAG_COLOR: Record<RsFlag, string> = {
  ch4:     '#f59e0b',
  plume:   '#dc2626',
  veg:     '#14b8a6',
  flat:    '#a78bfa',
  cluster: '#ec4899',
};

export const RS_FLAG_EXPR: Record<RsFlag, mapboxgl.Expression> = {
  ch4:     ['==', ['get', 'ch4_is_anomaly'], true],
  plume:   ['in', ['get', 'ch4_signal_source'], ['literal', ['plume:carbonmapper', 'plume:methaneair']]],
  veg:     ['==', ['get', 'veg_anomaly_detected'], true],
  flat:    ['==', ['get', 'is_artificially_flat'], true],
  cluster: ['>=', ['coalesce', ['get', 'cluster_neighbor_count'], 0], 2],
};

// ────────────────────────────────────────────────────────────────────────
// ODNR hazard overlays (Tier 1 informational — regulator-mapped polygons)
// ────────────────────────────────────────────────────────────────────────

export const HAZARD_FLAG_LABEL: Record<HazardFlag, string> = {
  aum_subsidence: 'Mine subsidence',
  dogrm_urban:    'DOGRM urban',
};

// Reuse the colors from the table page's hazard chips so the two views look
// consistent. amber / pink.
export const HAZARD_FLAG_COLOR: Record<HazardFlag, string> = {
  aum_subsidence: '#b45309',
  dogrm_urban:    '#ec4899',
};

export const HAZARD_FLAG_HINT: Record<HazardFlag, string> = {
  aum_subsidence: "Well sits inside a mapped Abandoned Underground Mine (ODNR DGS)",
  dogrm_urban:    "Well sits inside DOGRM’s regulatory urban-area definition",
};

export const HAZARD_FLAG_EXPR: Record<HazardFlag, mapboxgl.Expression> = {
  aum_subsidence: ['==', ['get', 'in_aum_subsidence_zone'], true],
  dogrm_urban:    ['==', ['get', 'in_dogrm_urban_area'],    true],
};

export const AUM_OPENING_DISTANCE_LABEL: Record<AumOpeningDistance, string> = {
  any:        'Mine opening (any)',
  under_500:  '≤ 0.3 mi',
  under_1km:  '≤ 0.6 mi',
  under_5km:  '≤ 3 mi',
};

export const AUM_OPENING_DISTANCE_METERS: Record<Exclude<AumOpeningDistance, 'any'>, number> = {
  under_500: 500,
  under_1km: 1000,
  under_5km: 5000,
};

export function aumOpeningDistanceExpr(level: AumOpeningDistance): mapboxgl.Expression | null {
  if (level === 'any') return null;
  return ['<', ['coalesce', ['get', 'nearest_aum_opening_m'], 1e9], AUM_OPENING_DISTANCE_METERS[level]];
}

export const TRI_DISTANCE_LABEL: Record<TriDistance, string> = {
  any:        'TRI facility (any)',
  under_500:  '≤ 0.3 mi',
  under_1km:  '≤ 0.6 mi',
  under_5km:  '≤ 3 mi',
};

export const TRI_DISTANCE_METERS: Record<Exclude<TriDistance, 'any'>, number> = {
  under_500: 500,
  under_1km: 1000,
  under_5km: 5000,
};

export function triDistanceExpr(level: TriDistance): mapboxgl.Expression | null {
  if (level === 'any') return null;
  return ['<', ['coalesce', ['get', 'nearest_tri_distance_m'], 1e9], TRI_DISTANCE_METERS[level]];
}

// ────────────────────────────────────────────────────────────────────────
// Wells card tab metadata
// ────────────────────────────────────────────────────────────────────────

export const WELLS_TABS: { key: WellsTab; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'activity', label: 'Activity' },
  { key: 'color',    label: 'Color'    },
  { key: 'flags',    label: 'Flags'    },
  { key: 'hazards',  label: 'Hazards'  },
  { key: 'land',     label: 'Land'     },
];

// ────────────────────────────────────────────────────────────────────────
// Activity classification
//
// Matches the 6-way buckets on detail pages, minus "Plugged" since plugged
// wells aren't in well_map_view.
// ────────────────────────────────────────────────────────────────────────

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  active:    'Producing (2020+)',
  aging:     'Producing (2015–19)',
  zombie:    'Producing (<2015)',
  paperwork: 'No production filed',
  other:     'Non-producing',
};

export const ACTIVITY_COLOR: Record<ActivityLevel, string> = {
  active:    '#9ca3af',
  aging:     '#eab308',
  zombie:    '#f97316',
  paperwork: '#f43f5e',
  other:     '#6b7280',
};

export const ACTIVITY_HINT: Record<ActivityLevel, string> = {
  active:    'Producing · last prod ≥ 2020',
  aging:     'Producing · last prod 2015–2019',
  zombie:    'Producing · last prod before 2015',
  paperwork: 'Producing · zero production on record',
  other:     'Non-producing (permit, inspection, FI WNF, …)',
};

// ────────────────────────────────────────────────────────────────────────
// County choropleth
// ────────────────────────────────────────────────────────────────────────

export const COUNTY_METRIC_LABELS: Record<CountyMetric, string> = {
  avg_risk_score: 'Avg risk',
  critical_count: 'Critical',
  high_count:     'High',
  medium_count:   'Medium',
  low_count:      'Low',
  annual_co2e_mt: 'Emissions',
};

// Each metric has its own meaningful scale — keep them separate rather than
// folding into a generic 0-100 ramp.
export function countyColorExpression(metric: CountyMetric): mapboxgl.Expression {
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
