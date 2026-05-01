import { useEffect, useRef, useState, type RefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import type { NearYouResult } from '@/lib/types';

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
}

interface Props {
  mapRef: RefObject<mapboxgl.Map | null>;
  onNearYouResult: (result: NearYouResult | null) => void;
}

// Address search box plus the user marker that gets pinned at the chosen
// place. The marker lives inside this component because no other UI pulls on
// it — the map sees it through `userMarkerRef.current` only.
export default function SearchBox({ mapRef, onNearYouResult }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<MapboxFeature[]>([]);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced geocoding — Mapbox Places API, scoped to Ohio's bbox so we
  // don't suggest Indiana towns that share a name with Ohio places.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSearchSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const bbox = '-84.8,38.4,-80.5,41.9';
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=US&bbox=${bbox}&access_token=${token}&limit=5`,
        );
        const json = await res.json();
        setSearchSuggestions(json.features ?? []);
      } catch {
        setSearchSuggestions([]);
      }
    }, 300);
  }, [searchQuery]);

  async function handleSelectPlace(feature: MapboxFeature) {
    const [lng, lat] = feature.center;
    const shortName = feature.place_name.split(',')[0];
    setSearchQuery(shortName);
    setSearchSuggestions([]);

    const m = mapRef.current;
    if (m) {
      m.flyTo({ center: [lng, lat], zoom: 12, duration: 800, essential: true });
    }

    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([lng, lat]);
    } else if (m) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:14px;height:14px;border-radius:50%;background:#60a5fa;border:3px solid #fff;box-shadow:0 0 0 6px rgba(96,165,250,0.2)';
      userMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
    }

    try {
      const res = await fetch(`/api/wells-near?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const data = await res.json();
        onNearYouResult({ ...data, place_name: shortName });
      }
    } catch (err) {
      console.error('[wells-near]', err);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchSuggestions([]);
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
    onNearYouResult(null);
  }

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (!e.target.value) clearSearch();
          }}
          placeholder="Find wells near you…"
          className="w-44 px-2.5 py-1.5 rounded text-xs bg-black/80 text-white border border-white/30 placeholder-gray-500 focus:outline-none focus:border-blue-400"
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            className="px-2 py-1.5 rounded text-xs bg-black/70 border border-white/20 text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        )}
      </div>
      {searchSuggestions.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-gray-900 border border-gray-700 rounded shadow-xl z-50 overflow-hidden">
          {searchSuggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSelectPlace(s)}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 hover:text-white border-b border-gray-800 last:border-0 transition-colors"
            >
              {s.place_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
