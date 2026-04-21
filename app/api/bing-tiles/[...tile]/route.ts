import { NextRequest, NextResponse } from 'next/server';

function toQuadkey(x: number, y: number, z: number): string {
  let key = '';
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit++;
    if ((y & mask) !== 0) digit += 2;
    key += digit;
  }
  return key;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tile: string[] }> }
) {
  const { tile } = await context.params;
  const [z, x, y] = tile.map(Number);

  if ([z, x, y].some(isNaN)) {
    return new NextResponse('Bad tile coordinates', { status: 400 });
  }

  const quadkey = toQuadkey(x, y, z);
  const server = (x + y + z) % 4;
  const url = `https://ecn.t${server}.tiles.virtualearth.net/tiles/a${quadkey}.jpeg?g=587&mkt=en-US&n=z`;

  const response = await fetch(url);
  if (!response.ok) {
    return new NextResponse('Tile fetch failed', { status: response.status });
  }

  const data = await response.arrayBuffer();
  return new NextResponse(data, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
