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
      .from('methane_plumes_flat')
      .select('id, source, plume_id, platform, sector, emission_kgph, observed_at, lng, lat')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.lng == null || row.lat == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: {
          id:            row.id,
          source:        row.source,
          plume_id:      row.plume_id,
          platform:      row.platform,
          sector:        row.sector,
          emission_kgph: row.emission_kgph,
          observed_at:   row.observed_at,
        },
      });
    }

    if (data.length < PAGE) break;
    page++;
  }

  return NextResponse.json(
    { type: 'FeatureCollection', features } satisfies GeoJSON.FeatureCollection,
    { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
  );
}
