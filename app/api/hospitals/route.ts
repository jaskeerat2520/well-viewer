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
      .from('hospitals_flat')
      .select('id, hospital_number, name, city, county, medicare_classification, service_category, trauma_level_adult, trauma_level_pediatric, lng, lat')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.lng == null || row.lat == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: {
          id:                     row.id,
          hospital_number:        row.hospital_number,
          name:                   row.name,
          city:                   row.city,
          county:                 row.county,
          medicare_classification: row.medicare_classification,
          service_category:       row.service_category,
          trauma_level_adult:     row.trauma_level_adult,
          trauma_level_pediatric: row.trauma_level_pediatric,
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
