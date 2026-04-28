import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BBOX_DEFAULT_LIMIT = 5000;
const BBOX_HARD_CAP = 10000;
const COUNTY_DEFAULT_LIMIT = 50000;
const COUNTY_HARD_CAP = 100000;
const BBOX_COUNTY_DEFAULT_LIMIT = 30000;
const BBOX_COUNTY_HARD_CAP = 60000;

type ParcelRow = {
  id: number;
  county: string;
  parcel_id: string;
  owner_name: string | null;
  acreage: number | null;
  land_use_code: string | null;
  geojson_str: string | null;
};

function rowsToFeatureCollection(rows: ParcelRow[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const row of rows) {
    if (!row.geojson_str) continue;
    features.push({
      type: 'Feature',
      geometry: JSON.parse(row.geojson_str),
      properties: {
        id:            row.id,
        county:        row.county,
        parcel_id:     row.parcel_id,
        owner_name:    row.owner_name,
        acreage:       row.acreage,
        land_use_code: row.land_use_code,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function parseBbox(bbox: string): [number, number, number, number] | { error: string } {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
    return { error: 'bbox must be 4 comma-separated numbers (w,s,e,n)' };
  }
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return { error: 'bbox must satisfy w<e and s<n' };
  return [w, s, e, n];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const county = searchParams.get('county');
  const bbox = searchParams.get('bbox');
  const userLimit = Number(searchParams.get('limit')) || 0;

  if (!county && !bbox) {
    return NextResponse.json({ error: 'either ?county=NAME or ?bbox=w,s,e,n is required' }, { status: 400 });
  }

  // County + bbox: viewport-filtered fetch within a single county.
  if (county && bbox) {
    const parsed = parseBbox(bbox);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const [w, s, e, n] = parsed;
    const lim = Math.min(BBOX_COUNTY_HARD_CAP, Math.max(1, userLimit || BBOX_COUNTY_DEFAULT_LIMIT));
    const { data, error } = await supabase.rpc('parcels_in_bbox_county', { w, s, e, n, county_name: county, lim });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(
      rowsToFeatureCollection((data ?? []) as ParcelRow[]),
      { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } },
    );
  }

  // County only: fetch all parcels for the county (capped).
  if (county) {
    const lim = Math.min(COUNTY_HARD_CAP, Math.max(1, userLimit || COUNTY_DEFAULT_LIMIT));
    const { data, error } = await supabase.rpc('parcels_for_county', { county_name: county, lim });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(
      rowsToFeatureCollection((data ?? []) as ParcelRow[]),
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } },
    );
  }

  // Bbox only: viewport-filtered, no county constraint.
  const parsed = parseBbox(bbox!);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const [w, s, e, n] = parsed;
  const lim = Math.min(BBOX_HARD_CAP, Math.max(1, userLimit || BBOX_DEFAULT_LIMIT));
  const { data, error } = await supabase.rpc('parcels_in_bbox', { w, s, e, n, lim });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    rowsToFeatureCollection((data ?? []) as ParcelRow[]),
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
