export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface WellPoint {
  api_no: string;
  lat: number;
  lng: number;
  priority: Priority;
  risk_score: number;
}

export interface WellDetail {
  api_no: string;
  priority: Priority;
  risk_score: number;
  water_risk_score: number;
  population_risk_score: number;
  inactivity_score: number;
  nearest_water_distance_m: number;
  within_protection_zone: boolean;
  operator_status: string;
  population_within_1km: number;
  population_within_5km: number;
  years_inactive: number | null;
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
