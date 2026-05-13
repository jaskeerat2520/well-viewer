import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const PAGE = 1000;

// Returns one FeatureCollection containing all four polygon layer_types.
// The map registers one source and four fill/outline layer pairs that filter
// on `layer_type` so each type can be toggled independently.
export async function GET() {
  const features: GeoJSON.Feature[] = [];
  let page = 0;

  while (true) {
    // Read from the flat view (geojson_str is pre-computed via ST_AsGeoJSON
    // at view-define time, so no PostGIS work happens per request). raw_attrs
    // was added to the flat view in the popup-detail migration.
    const { data, error } = await supabase
      .from('odnr_hazard_layers_flat')
      .select('id, layer_type, external_id, name, area_km2, popup_attrs, geojson_str')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (!row.geojson_str) continue;
      features.push({
        type: 'Feature',
        geometry: JSON.parse(row.geojson_str),
        properties: {
          id:          row.id,
          layer_type:  row.layer_type,
          external_id: row.external_id,
          name:        row.name,
          area_km2:    row.area_km2,
          // Whitelisted per-layer popup fields (FEMA FLD_ZONE, AML PROJ_NUM,
          // mine COMMODITY/OP_NAME etc.). View extracts these so the API
          // doesn't ship every junk attr (GlobalID, created_user, etc.).
          attrs:       row.popup_attrs ?? null,
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
