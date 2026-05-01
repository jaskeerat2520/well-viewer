import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const PAGE = 1000;

export async function GET() {
  const features: GeoJSON.Feature[] = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('schools_flat')
      .select('id, name, district, school_type, lng, lat')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.lng == null || row.lat == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: {
          id:          row.id,
          name:        row.name,
          district:    row.district,
          school_type: row.school_type,
        },
      });
    }

    if (data.length < PAGE) break;
    page++;
  }

  return NextResponse.json(
    { type: 'FeatureCollection', features } satisfies GeoJSON.FeatureCollection,
    { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } }
  );
}
