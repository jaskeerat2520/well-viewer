import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Ohio's bounding envelope. The dataset is tiny (~500 rows / ~440 distinct
// cases) so we always go through spills_in_bbox — that path also dedupes
// the multi-line-item-per-incident records via DISTINCT ON (case_number).
const OHIO_BBOX = { w: -85.0, s: 38.3, e: -80.4, n: 42.0 };
const DEFAULT_LIMIT = 2000;
const HARD_CAP = 5000;

type SpillRow = {
  case_number: string;
  reported_product: string | null;
  reported_amount: number | null;
  reported_uom: string | null;
  reported_date: string | null;
  county: string | null;
  city_township: string | null;
  waterway: string | null;
  is_oil_gas: boolean;
  lng: number | null;
  lat: number | null;
};

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
  const bboxParam = searchParams.get('bbox');
  const oilGasOnly = searchParams.get('oilgas') === '1';
  const userLimit = Number(searchParams.get('limit')) || 0;

  let bounds: [number, number, number, number];
  if (bboxParam) {
    const parsed = parseBbox(bboxParam);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    bounds = parsed;
  } else {
    bounds = [OHIO_BBOX.w, OHIO_BBOX.s, OHIO_BBOX.e, OHIO_BBOX.n];
  }

  const lim = Math.min(HARD_CAP, Math.max(1, userLimit || DEFAULT_LIMIT));
  const [w, s, e, n] = bounds;

  const { data, error } = await supabase.rpc('spills_in_bbox', { w, s, e, n, lim });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as SpillRow[];
  const features: GeoJSON.Feature[] = [];
  for (const row of rows) {
    if (row.lng == null || row.lat == null) continue;
    if (oilGasOnly && !row.is_oil_gas) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
      properties: {
        case_number:      row.case_number,
        reported_product: row.reported_product,
        reported_amount:  row.reported_amount,
        reported_uom:     row.reported_uom,
        reported_date:    row.reported_date,
        county:           row.county,
        city_township:    row.city_township,
        waterway:         row.waterway,
        is_oil_gas:       row.is_oil_gas,
      },
    });
  }

  return NextResponse.json(
    { type: 'FeatureCollection', features } satisfies GeoJSON.FeatureCollection,
    { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
  );
}
