// Display-layer unit conversion. The database, PostGIS, and GEE pipeline all
// store/compute in SI (meters). These helpers exist to render US customary
// units in the UI without touching the backend contract.

const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;

export function metersToFeet(m: number): number {
  return m / M_PER_FT;
}

export function metersToMiles(m: number): number {
  return m / M_PER_MI;
}

// Auto-picks ft vs mi based on magnitude. Intended for variable distances
// (e.g. a well's nearest-water distance), not fixed radii that appear in
// labels — use the RADIUS_* constants for those so wording stays consistent.
export function formatDistanceUS(meters: number | null | undefined): string {
  if (meters == null) return '—';
  const ft = metersToFeet(meters);
  if (ft < 1000) return `${Math.round(ft).toLocaleString()} ft`;
  const mi = metersToMiles(meters);
  return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

export function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

// For temperature deltas (anomalies): no +32 offset, only scale
export function celsiusDeltaToFahrenheit(delta: number): number {
  return delta * 9 / 5;
}

// Fixed radii baked into the scoring pipeline. Keeping these as constants
// (rather than computing from the metric value at each call site) ensures
// every page uses the same wording for the same underlying buffer.
export const RADIUS_100M  = '330 ft';     // 100 m ≈ 328 ft  — well-pad buffer
export const RADIUS_300M  = '1,000 ft';   // 300 m ≈ 984 ft  — OSIP thumbnail
export const RADIUS_400M  = '1,300 ft';   // 400 m ≈ 1,312 ft — terrain background
export const RADIUS_500M  = '0.3 mi';     // 500 m ≈ 1,640 ft — water-proximity tier
export const RADIUS_1KM   = '0.6 mi';     // 1 km  ≈ 0.62 mi — population / CH4 plume tier
export const RADIUS_2KM   = '1.2 mi';     // 2 km  ≈ 1.24 mi — water-proximity tier
export const RADIUS_5KM   = '3 mi';       // 5 km  ≈ 3.1 mi  — population regional tier
export const RADIUS_5_5KM = '3.4 mi';     // 5.5 km ≈ 3.42 mi — S5P pixel footprint
export const RADIUS_10KM  = '6 mi';       // 10 km ≈ 6.2 mi  — S5P background
export const RADIUS_10M   = '33 ft';      // 10 m — Sentinel-2 / DEM pixel, cluster inner
export const RADIUS_30M   = '100 ft';     // 30 m — cluster outer
