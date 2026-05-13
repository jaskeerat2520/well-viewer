import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-only client. We use the service-role key here because PostgREST
// enforces `db-max-rows` (≈1000) on the anon role, which silently truncates
// our paginated RPC responses regardless of the SQL LIMIT. Service-role bypasses
// that cap. The key is read from a NON-public env var (no NEXT_PUBLIC_ prefix)
// so it never reaches the browser bundle. If the env var isn't set, fall
// back to the anon key with a runtime warning — pages will still load but
// will be truncated to 1000 rows each, which is the bug we're trying to fix.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!SERVICE_KEY) {
  console.warn(
    '[parcels] SUPABASE_SERVICE_ROLE_KEY not set — using anon key, ' +
    'which means PostgREST db-max-rows will truncate every page to ~1000 ' +
    'rows and the map will only show a sliver of each county. Add the ' +
    'service-role key to .env.local to fix.',
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  SERVICE_KEY ?? ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

const BBOX_DEFAULT_LIMIT = 5000;
const BBOX_HARD_CAP = 10000;
// County path is now keyset-paginated — see parcels_for_county_page. Per-page
// ceiling matches the RPC's internal LEAST(lim, 30000); the client loops
// until a page returns < page_size rows. The single-shot LIMIT 100000 in the
// old parcels_for_county silently truncated Cuyahoga (484K parcels) to ~20%.
// Each page is ~150ms server-side now that parcels_county_id_idx is in place,
// so the round-trip count dominates total load time. 30K is the RPC's internal
// ceiling; using it halves the number of pages for big counties.
const COUNTY_PAGE_DEFAULT_LIMIT = 30000;
const COUNTY_PAGE_HARD_CAP      = 30000;
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

  // County only: one page of a keyset-paginated walk through the county.
  // The client passes ?after_id=<last_id_seen> and loops until a page returns
  // < page_size rows. Each page is its own cache key so CDN re-uses pages
  // across users hitting the same county. The header `x-next-after-id`
  // (= max id in this page) is what the client passes back as `after_id` on
  // the next call; we send `-1` (or omit) once we've drained the county.
  if (county) {
    const afterId = Number(searchParams.get('after_id')) || 0;
    const lim = Math.min(COUNTY_PAGE_HARD_CAP, Math.max(1, userLimit || COUNTY_PAGE_DEFAULT_LIMIT));
    const { data, error } = await supabase.rpc('parcels_for_county_page', {
      county_name: county,
      after_id:    afterId,
      lim,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as ParcelRow[];
    const fc = rowsToFeatureCollection(rows);
    const nextAfterId = rows.length === lim
      ? String(rows[rows.length - 1].id)
      : '';   // empty = no more pages

    return NextResponse.json(fc, {
      headers: {
        // Long-lived: a page is uniquely identified by (county, after_id) and
        // the parcels table is updated infrequently; CDN re-hit is the goal.
        'Cache-Control':   'public, max-age=3600, s-maxage=3600',
        'x-next-after-id': nextAfterId,
        'x-page-size':     String(rows.length),
      },
    });
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
