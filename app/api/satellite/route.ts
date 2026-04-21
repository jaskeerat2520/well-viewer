import { NextRequest, NextResponse } from 'next/server';

const SATELLITE_SERVICE = process.env.SATELLITE_SERVICE_URL ?? 'http://localhost:8001';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${SATELLITE_SERVICE}/analyze?lat=${lat}&lng=${lng}`,
      { signal: AbortSignal.timeout(60_000) }   // GEE can be slow
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Satellite service unavailable';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
