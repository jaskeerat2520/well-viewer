import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Pad-detection candidates from well_pad_candidates view (pad_score >= 30).
// Sub-meter pad detection (NAIP NDVI + OSIP edge) flags wells with visible
// physical disturbance that the composite_risk pipeline doesn't necessarily
// surface. This is a *review queue* — humans triage; nothing is auto-promoted.

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
      .from('well_pad_candidates')
      .select('api_no, county, lat, lng, pad_score, pad_score_raw, land_cover, naip_ndvi_pad, naip_delta, edge_ratio, abs_signal, delta_signal, edge_signal, composite_risk, composite_priority, well_name, operator, well_status')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.lng == null || row.lat == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: {
          api_no:             row.api_no,
          county:             row.county,
          pad_score:          row.pad_score,
          pad_score_raw:      row.pad_score_raw,
          land_cover:         row.land_cover,
          naip_ndvi_pad:      row.naip_ndvi_pad,
          naip_delta:         row.naip_delta,
          edge_ratio:         row.edge_ratio,
          abs_signal:         row.abs_signal,
          delta_signal:       row.delta_signal,
          edge_signal:        row.edge_signal,
          composite_risk:     row.composite_risk,
          composite_priority: row.composite_priority,
          well_name:          row.well_name,
          operator:           row.operator,
          well_status:        row.well_status,
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
