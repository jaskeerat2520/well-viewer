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
      .from('water_sources_flat')
      .select('id, name, source_type, protection_zone, public_water_system, geojson_str')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (!row.geojson_str) continue;
      features.push({
        type: 'Feature',
        geometry: JSON.parse(row.geojson_str),
        properties: {
          id:                  row.id,
          name:                row.name,
          source_type:         row.source_type,
          protection_zone:     row.protection_zone,
          public_water_system: row.public_water_system,
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
