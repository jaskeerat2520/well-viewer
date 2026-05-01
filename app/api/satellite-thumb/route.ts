import { NextRequest, NextResponse } from 'next/server';

const SATELLITE_SERVICE = process.env.SATELLITE_SERVICE_URL ?? 'http://localhost:8001';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const recentYear = searchParams.get('recent_year');

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  const upstream = new URL(`${SATELLITE_SERVICE}/thumbnails`);
  upstream.searchParams.set('lat', lat);
  upstream.searchParams.set('lng', lng);
  if (recentYear && /^\d{4}$/.test(recentYear)) {
    upstream.searchParams.set('recent_year', recentYear);
  }

  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Satellite service unavailable';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
