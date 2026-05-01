import mapboxgl from 'mapbox-gl';
import { Protocol } from 'pmtiles';

// Registers the `pmtiles://` URL scheme with Mapbox GL so vector-tile sources
// can read directly from a static .pmtiles archive (Supabase Storage in our
// case) via HTTP byte-range requests. The Protocol instance keeps a small
// in-memory cache of header + directory pages so per-tile fetches stay cheap.
//
// Idempotent: addProtocol throws if called twice with the same scheme, and
// React 19 strict mode double-invokes effects in dev.

// addProtocol exists at runtime in mapbox-gl 2+ but is missing from both the
// bundled and @types/mapbox-gl typings.
type MapboxWithProtocol = typeof mapboxgl & {
  addProtocol: (scheme: string, loader: Protocol['tile']) => void;
};

let registered = false;

export function ensurePmtilesProtocol() {
  if (registered) return;
  const protocol = new Protocol();
  (mapboxgl as MapboxWithProtocol).addProtocol('pmtiles', protocol.tile);
  registered = true;
}
