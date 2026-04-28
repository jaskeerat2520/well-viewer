'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

interface Props {
  lat: number;
  lng: number;
  zoom?: number;
  height?: number;
}

// Small embedded mapbox map showing Ohio OSIP aerial tiles centered on a
// well — used on the well detail page so a human can visually verify what
// the Sentinel/Landsat-derived risk signals are flagging. OSIP is 6"–1ft
// resolution so individual tanks, pads, and access roads are legible.
export default function OsipThumb({ lat, lng, zoom = 18, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const m = new mapboxgl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      center: [lng, lat],
      zoom,
      attributionControl: false,
      cooperativeGestures: false,
    });
    mapRef.current = m;

    m.on('load', () => {
      m.addSource('osip', {
        type: 'raster',
        tiles: ['https://maps.ohio.gov/image/rest/services/osip_most_current_cache/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Ohio OIT / OGRIP — OSIP',
        minzoom: 7,
      });
      m.addLayer({ id: 'osip', type: 'raster', source: 'osip' });

      new mapboxgl.Marker({ color: '#facc15' })
        .setLngLat([lng, lat])
        .addTo(m);
    });

    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    return () => { m.remove(); mapRef.current = null; };
  }, [lat, lng, zoom]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height, borderRadius: 4, overflow: 'hidden' }}
    />
  );
}
