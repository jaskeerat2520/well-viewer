import { getCached, setCached, clearCached } from './idbCache';

const KEY = 'wells_features';
const VERSION = 3; // bumped 2026-05-05 — added TRI proximity fields
const TTL_MS = 24 * 60 * 60 * 1000;

export function loadCachedWells(): Promise<GeoJSON.Feature[] | null> {
  return getCached<GeoJSON.Feature[]>(KEY, VERSION, TTL_MS);
}

export function saveCachedWells(features: GeoJSON.Feature[]): Promise<void> {
  return setCached(KEY, VERSION, features);
}

export function clearCachedWells(): Promise<void> {
  return clearCached(KEY);
}
