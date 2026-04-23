export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface WellPoint {
  api_no: string;
  lat: number;
  lng: number;
  priority: Priority;
  risk_score: number;
  land_cover: LandCoverCode | null;
}

// ESA WorldCover 2021 class codes. Stored as-is in wells.land_cover so the
// DB survives any UI re-labeling.
export type LandCoverCode = 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 95 | 100;

export const LAND_COVER_LABEL: Record<LandCoverCode, string> = {
  10:  'Forest',
  20:  'Shrubland',
  30:  'Grassland',
  40:  'Cropland',
  50:  'Built-up',
  60:  'Bare',
  70:  'Snow/ice',
  80:  'Water',
  90:  'Wetland',
  95:  'Mangrove',
  100: 'Moss/lichen',
};

export const LAND_COVER_COLOR: Record<LandCoverCode, string> = {
  10:  '#166534',  // forest — dark green
  20:  '#84cc16',  // shrub — lime
  30:  '#fde047',  // grass — pale yellow
  40:  '#f59e0b',  // crop — amber
  50:  '#9ca3af',  // built — slate gray
  60:  '#d6d3d1',  // bare — stone
  70:  '#e0f2fe',  // snow — pale blue
  80:  '#0ea5e9',  // water — sky
  90:  '#14b8a6',  // wetland — teal
  95:  '#0d9488',  // mangrove — darker teal
  100: '#a3a3a3',  // moss — neutral
};

export type Ch4SignalSource =
  | 'plume:carbonmapper'
  | 'plume:methaneair'
  | 'l3:methaneair'
  | 'l3:s5p_hotspot'
  | 'l3:s5p_below_threshold';

export interface WellDetail {
  api_no: string;
  priority: Priority;
  risk_score: number;
  water_risk_score: number;
  population_risk_score: number;
  inactivity_score: number;
  emissions_risk_score: number | null;
  vegetation_risk_score: number | null;
  terrain_risk_score: number | null;
  composite_risk_score: number | null;
  nearest_water_distance_m: number;
  within_protection_zone: boolean;
  operator_status: string;
  population_within_1km: number;
  population_within_5km: number;
  years_inactive: number | null;
  land_cover: LandCoverCode | null;
  // Emissions detail (well_remote_sensing)
  ch4_is_anomaly: boolean | null;
  ch4_signal_source: Ch4SignalSource | string | null;
  ch4_well_ppb: number | null;
  ch4_background_ppb: number | null;
  ch4_anomaly_ratio: number | null;
  thermal_anomaly_c: number | null;
  // Terrain detail (well_remote_sensing)
  is_artificially_flat: boolean | null;
  slope_ratio: number | null;
  // Vegetation detail (well_surface_anomalies)
  veg_anomaly_detected: boolean | null;
  veg_anomaly_type: string | null;
  ndvi_relative: number | null;
  ndvi_trend_slope: number | null;
  // Spatial cluster: how many other wells sit within 10-30m (signal of an
  // old infill pad or orphan cluster — strong plugging-consolidation candidate)
  cluster_neighbor_count: number | null;
  well: {
    well_name: string | null;
    county: string;
    status: string;
    operator: string;
    well_type: string;
    lat: number;
    lng: number;
  };
}

export const CH4_SOURCE_COLOR: Record<string, string> = {
  'plume:carbonmapper':     '#dc2626',
  'plume:methaneair':       '#dc2626',
  'l3:methaneair':          '#f97316',
  'l3:s5p_hotspot':         '#f59e0b',
  'l3:s5p_below_threshold': '#6b7280',
};

export const CH4_SOURCE_LABEL: Record<string, string> = {
  'plume:carbonmapper':     'CarbonMapper plume',
  'plume:methaneair':       'MethaneAIR L4 plume',
  'l3:methaneair':          'MethaneAIR L3 grid',
  'l3:s5p_hotspot':         'Sentinel-5P hotspot',
  'l3:s5p_below_threshold': 'Sentinel-5P (below threshold)',
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
};

export interface CountySummary {
  fips_code: string;
  county: string;
  total_wells: number;
  scored_wells: number;
  avg_risk_score: number | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  in_orphan_program: number;
  cost_low: number | null;
  cost_mid: number | null;
  cost_high: number | null;
}

export type WaterSourceType =
  | 'groundwater'
  | 'surface_water_inland'
  | 'surface_water_lake_erie'
  | 'surface_water_ohio_river';

export const WATER_SOURCE_COLOR: Record<WaterSourceType, string> = {
  groundwater:              '#3b82f6',
  surface_water_inland:     '#0891b2',
  surface_water_lake_erie:  '#0e7490',
  surface_water_ohio_river: '#155e75',
};

export interface NearYouResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  in_zone: boolean;
  max_pop_1km: number | null;
  place_name: string;
}

export interface CountyImpactRow {
  county: string;
  unplugged_wells: number;
  total_pop_1km: number;
  total_pop_5km: number;
  max_pop_1km_single_well: number;
  wells_in_protection_zone: number;
  pct_in_protection_zone: number;
  avg_water_risk_score: number | null;
  high_water_risk_count: number;
  avg_pop_risk_score: number | null;
}

export interface CountyEmissionsRow {
  county: string;
  unplugged_wells: number;
  gas_wells: number;
  oil_wells: number;
  brine_wells: number;
  unknown_wells: number;
  annual_co2e_mt: number;
  cars_equivalent: number;
}
