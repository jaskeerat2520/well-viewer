import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_RADIUS_M = 1000;
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 5000;

type NearbySpill = {
  case_number: string;
  reported_product: string | null;
  reported_amount: number | null;
  reported_uom: string | null;
  reported_date: string | null;
  city_township: string | null;
  waterway: string | null;
  is_oil_gas: boolean;
  distance_m: number;
  lng: number;
  lat: number;
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ api: string }> }
) {
  const { api } = await context.params;
  const apiNo = decodeURIComponent(api);

  const { searchParams } = new URL(req.url);
  const requested = Number(searchParams.get('radius_m')) || DEFAULT_RADIUS_M;
  const radius = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, requested));

  const { data, error } = await supabase.rpc('spills_near_well', {
    p_api_no: apiNo,
    p_radius_m: radius,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const spills = (data ?? []) as NearbySpill[];

  return NextResponse.json(
    { api_no: apiNo, radius_m: radius, count: spills.length, spills },
    { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } }
  );
}
