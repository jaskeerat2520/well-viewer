import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const PAGE = 1000;

// Returns all active OH TRI facilities with valid geometry as a Point
// FeatureCollection. Mirrors /api/schools and /api/hospitals — flat view
// pre-projects lat/lng so PostgREST doesn't ship raw geometry.
export async function GET() {
  const features: GeoJSON.Feature[] = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('tri_facilities_flat')
      .select('id, tri_facility_id, facility_name, parent_company, foreign_parent, city, county, lng, lat')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.lng == null || row.lat == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: {
          id:              row.id,
          tri_facility_id: row.tri_facility_id,
          facility_name:   row.facility_name,
          parent_company:  row.parent_company,
          foreign_parent:  row.foreign_parent,
          city:            row.city,
          county:          row.county,
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
