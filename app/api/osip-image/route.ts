import { NextRequest, NextResponse } from 'next/server';

// Proxies aerial imagery for the before/after well slider.
//
//  before = USDA NAIP (USDA_CONUS_PRIME) — publicly accessible, ~2020-2022 for Ohio
//  after  = Mapbox Static Images API    — most recent satellite composite
//
// Both are server-side fetches to avoid CORS and keep the Mapbox token off the client.

const NAIP_EXPORT = 'https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage';
const MAPBOX_STYLE = 'mapbox://styles/mapbox/satellite-v9';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat  = parseFloat(searchParams.get('lat')  ?? '');
  const lng  = parseFloat(searchParams.get('lng')  ?? '');
  const year = searchParams.get('year') ?? 'current';   // 'before' or 'current'

  if (isNaN(lat) || isNaN(lng)) {
    return new NextResponse('lat and lng required', { status: 400 });
  }

  const d    = 0.0027;   // ~300 m radius at Ohio latitude
  const minLng = lng - d, minLat = lat - d;
  const maxLng = lng + d, maxLat = lat + d;

  try {
    let url: string;

    if (year === 'before') {
      // NAIP exportImage — public, no auth, returns JPEG
      const params = new URLSearchParams({
        bbox:        `${minLng},${minLat},${maxLng},${maxLat}`,
        bboxSR:      '4326',
        size:        '512,512',
        format:      'jpg',
        f:           'image',
      });
      url = `${NAIP_EXPORT}?${params}`;
    } else {
      // Mapbox Static Images API — bbox mode keeps both images pixel-aligned
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const bbox  = `[${minLng},${minLat},${maxLng},${maxLat}]`;
      url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${bbox}/512x512@2x?access_token=${token}&attribution=false&logo=false`;
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Ohio-Well-Viewer/1.0' },
    });

    if (!res.ok) return new NextResponse(`Upstream error ${res.status}`, { status: 502 });

    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    if (contentType.includes('xml') || contentType.includes('text') || contentType.includes('json')) {
      const text = await res.text();
      return new NextResponse(text, { status: 502, headers: { 'Content-Type': 'text/plain' } });
    }

    const data = await res.arrayBuffer();
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: unknown) {
    return new NextResponse(err instanceof Error ? err.message : 'Fetch failed', { status: 502 });
  }
}
