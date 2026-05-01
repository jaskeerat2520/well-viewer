'use client';

import { useEffect, useState } from 'react';

// Sentinel-2 median composites — a 2017–18 stitched baseline vs a user-selected
// recent year, fetched from /api/satellite-thumb. Single row of true-color
// (B4/B3/B2) RGB photos. NDVI false-color rows were removed because the user
// reported they read as "different shades of green" and carried less signal
// than the actual photo. NDVI mean numbers are still surfaced as inline text.
// Baseline year label comes from the response so this stays in sync if the
// backend window shifts.

interface Props {
  lat: number;
  lng: number;
}

interface ThumbPair {
  baseline_url: string | null;
  recent_url:   string | null;
}

interface ThumbResponse {
  baseline_year: string;
  recent_year:   string;
  gap_years:     number;
  imagery: ThumbPair;
  ndvi: {
    baseline_mean: number | null;
    recent_mean:   number | null;
    change:        number | null;
    relative:      number | null;
    anomaly_type:  string;
  };
}

const CURRENT_YEAR = new Date().getFullYear();
// MIN_YEAR is 2019 because the backend baseline now spans 2017-2018; the recent
// window must not overlap it. Keep this in sync with the `ge=` floor on
// satellite_service.py's recent_year Query param.
const MIN_YEAR     = 2019;
const MAX_YEAR     = CURRENT_YEAR - 1;
const YEARS        = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MAX_YEAR - i);

type Result =
  | { kind: 'done';  key: string; data: ThumbResponse }
  | { kind: 'error'; key: string; message: string };

export default function ImageryComparison({ lat, lng }: Props) {
  const [recentYear, setRecentYear] = useState<number>(MAX_YEAR);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [result,     setResult]     = useState<Result | null>(null);

  // Stable identifier for "what we last asked the server for". When result.key
  // doesn't match this, we're by definition still loading — no synchronous
  // setState in the effect body, so we sidestep react-hooks/set-state-in-effect.
  const requestKey = `${lat}|${lng}|${recentYear}|${refreshKey}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const key  = requestKey;
    fetch(`/api/satellite-thumb?lat=${lat}&lng=${lng}&recent_year=${recentYear}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (d.error) throw new Error(typeof d.error === 'string' ? d.error : 'Failed');
        setResult({ kind: 'done', key, data: d as ThumbResponse });
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setResult({ kind: 'error', key, message: e instanceof Error ? e.message : 'Failed' });
      });
    return () => ctrl.abort();
  }, [lat, lng, recentYear, refreshKey, requestKey]);

  const status: 'loading' | 'done' | 'error' =
    result == null || result.key !== requestKey ? 'loading' : result.kind;
  const data   = status === 'done'  && result?.kind === 'done'  ? result.data    : null;
  const errMsg = status === 'error' && result?.kind === 'error' ? result.message : '';

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-[11px] text-gray-400">
          Compare {data?.baseline_year ?? '2017–18'} →
        </span>
        <select
          value={recentYear}
          onChange={(e) => setRecentYear(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1"
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {status === 'done' && data && (
          <span className="text-[10px] text-gray-500">
            {data.gap_years}-year gap · NDVI mean{' '}
            {data.ndvi.baseline_mean != null ? data.ndvi.baseline_mean.toFixed(2) : '—'} →{' '}
            {data.ndvi.recent_mean   != null ? data.ndvi.recent_mean.toFixed(2)   : '—'}
            {data.ndvi.anomaly_type && data.ndvi.anomaly_type !== 'stable' && (
              <span className="ml-2 text-amber-300">({data.ndvi.anomaly_type.replace(/_/g, ' ')})</span>
            )}
          </span>
        )}
      </div>

      {status === 'loading' && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="aspect-square bg-gray-800 animate-pulse rounded" />
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Generating composites — 5–15 s on first request.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="border border-red-800 rounded p-3 text-xs text-red-300">
          <p>Imagery unavailable: {errMsg}</p>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="mt-2 px-2 py-1 bg-red-900/40 border border-red-800 rounded text-[11px] hover:bg-red-900/60"
          >
            Retry
          </button>
        </div>
      )}

      {status === 'done' && data && (
        <ImageryRow
          label="True color (Sentinel-2 RGB)"
          baselineUrl={data.imagery.baseline_url}
          recentUrl={data.imagery.recent_url}
          baselineYear={data.baseline_year}
          recentYear={recentYear}
        />
      )}
    </div>
  );
}

interface RowProps {
  label:        string;
  baselineUrl:  string | null;
  recentUrl:    string | null;
  baselineYear: string;
  recentYear:   number;
}

function ImageryRow({ label, baselineUrl, recentUrl, baselineYear, recentYear }: RowProps) {
  return (
    <div>
      <h5 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{label}</h5>
      <div className="grid grid-cols-2 gap-3">
        <ImageCell url={baselineUrl} year={baselineYear} />
        <ImageCell url={recentUrl}   year={String(recentYear)} />
      </div>
    </div>
  );
}

function ImageCell({ url, year }: { url: string | null; year: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div>
      <div className="text-[10px] text-gray-400 mb-1">{year}</div>
      {url && !broken ? (
        // GEE thumbnails are signed one-off URLs on earthengine-highvolume.googleapis.com;
        // next/image would need that host added to next.config images.remotePatterns and
        // wouldn't help much (each URL is unique, so optimization cache misses every load).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Sentinel-2 composite for ${year}`}
          loading="lazy"
          onError={() => setBroken(true)}
          className="w-full aspect-square object-cover rounded border border-gray-700 bg-gray-900"
        />
      ) : (
        <div className="w-full aspect-square rounded border border-gray-700 bg-gray-900 flex items-center justify-center text-[10px] text-gray-600">
          No clear pixels
        </div>
      )}
    </div>
  );
}
