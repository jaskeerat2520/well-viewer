'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { WellDetail, Priority, PRIORITY_COLOR, CountySummary, NearYouResult } from '@/lib/types';

// ── Satellite types ────────────────────────────────────────────────────────────
interface ThumbPair { baseline_url?: string | null; recent_url?: string | null; }
interface AnalysisResult {
  baseline_year: string; recent_year: string; gap_years: number;
  imagery: ThumbPair;
  ndvi:    ThumbPair & { baseline_mean?: number; recent_mean?: number; change?: number; relative?: number; anomaly_type?: string; };
  ndmi:    ThumbPair & { baseline_mean?: number; recent_mean?: number; change?: number; is_dry_anomaly?: boolean; };
  swir:    ThumbPair;
  terrain: { hillshade_url?: string | null; mean_slope_well?: number; mean_slope_bg?: number; is_flat?: boolean; error?: string; };
}
interface GeeScores {
  ndvi: { baseline?: number; recent?: number; change?: number; relative_change?: number; score?: number; anomaly_type?: string; baseline_years?: string; recent_years?: string; error?: string; };
  methane: { well_ppb?: number | null; background_ppb?: number | null; anomaly_ratio?: number | null; is_anomaly?: boolean; error?: string; };
}

const NDVI_TYPE_COLOR: Record<string, string> = {
  stable: '#22c55e', minor_change: '#eab308', moderate_change: '#f97316',
  vegetation_loss: '#ef4444', severe_loss: '#b91c1c', near_total_loss: '#7f1d1d',
  low_baseline_skip: '#6b7280', no_data: '#6b7280',
};

// ── Shared before/after image slider ──────────────────────────────────────────
function ImageSlider({ pair, baseLabel, recentLabel }: {
  pair: ThumbPair; baseLabel: string; recentLabel: string;
}) {
  const [slider, setSlider] = useState(50);
  if (!pair.baseline_url && !pair.recent_url)
    return <p className="text-xs text-gray-600 py-2 text-center">No imagery available</p>;
  return (
    <div className="relative w-full rounded overflow-hidden bg-gray-800" style={{ aspectRatio: '1' }}>
      {pair.baseline_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pair.baseline_url} alt="baseline" className="absolute inset-0 w-full h-full object-cover" />
      )}
      {pair.recent_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pair.recent_url} alt="recent" className="absolute inset-0 w-full h-full object-cover"
          style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }} />
      )}
      <div className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none" style={{ left: `${slider}%` }} />
      {/* Well marker — always at exact centre since GEE buffers symmetrically */}
      <div className="absolute pointer-events-none" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', boxShadow: '0 0 0 3px rgba(239,68,68,0.4)' }} />
      </div>
      <span className="absolute bottom-1.5 left-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">{baseLabel}</span>
      <span className="absolute bottom-1.5 right-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">{recentLabel}</span>
      <input type="range" min={0} max={100} value={slider} onChange={e => setSlider(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize" />
    </div>
  );
}

// ── Unified four-analysis satellite panel ──────────────────────────────────────
type SatTab = 'imagery' | 'ndvi' | 'ndmi' | 'swir' | 'terrain';

const TAB_META: Record<SatTab, { label: string; title: string; blurb: string }> = {
  imagery:  { label: 'True colour', title: 'Site overview',        blurb: 'Natural-colour view. Look for cleared land, well pads, access roads, or changed land cover.' },
  ndvi:     { label: 'Vegetation',  title: 'Vegetation ghost',     blurb: 'NDVI (NIR−Red)/(NIR+Red). Even after trees regrow, soil compaction and residual hydrocarbons cause a "productivity gap" — lighter green or yellow vs. surrounding forest.' },
  ndmi:     { label: 'Moisture',    title: 'Salt burn',            blurb: 'NDMI (NIR−SWIR1)/(NIR+SWIR1). Produced-water brine spills kill soil microbes for decades. A dry patch on the moisture map exactly marks an old spill site.' },
  swir:     { label: 'SWIR',        title: 'Gas / soil stress',    blurb: 'False-colour B12/B8/B4. Methane replacing soil oxygen creates bald spots; exposed soil and stressed vegetation appear vivid red/magenta in SWIR false colour.' },
  terrain:  { label: 'Terrain',     title: 'Artificial flatness',  blurb: 'USGS NED 10 m DEM hillshade. A well pad is an unnaturally flat square carved into forest. Natural floors are uneven — the pad shelf persists for decades under regrown trees.' },
};

function LandsatSlider({ lat, lng }: { lat: number; lng: number }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [thumbs, setThumbs] = useState<ThumbResult | null>(null);
  const [slider, setSlider] = useState(50);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => { setStatus('idle'); setThumbs(null); }, [lat, lng]);

  async function load() {
    setStatus('loading');
    try {
      const res = await fetch(`/api/satellite-thumb?lat=${lat}&lng=${lng}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setThumbs(data);
      setStatus('done');
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : 'Failed');
      setStatus('error');
    }
  }

  if (status === 'idle') return (
    <div>
      <button onClick={load}
        className="w-full py-2 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 transition-colors text-white"
      >
        Load before/after imagery ↗
      </button>
      <p className="text-xs text-gray-600 mt-1.5 text-center">Sentinel-2 10m · 2016 vs 2023–24 via GEE</p>
    </div>
  );

  if (status === 'loading') return (
    <p className="text-xs text-gray-400 text-center animate-pulse py-4">Fetching Landsat imagery…</p>
  );

  if (status === 'error') return (
    <div>
      <p className="text-xs text-gray-500">
        {errMsg.includes('503') || errMsg.includes('unavailable')
          ? 'GEE service not running — start satellite_service.py'
          : errMsg}
      </p>
      <button onClick={() => setStatus('idle')} className="text-xs text-gray-600 hover:text-white mt-1">Retry</button>
    </div>
  );

  return (
    <div>
      <div className="relative w-full rounded overflow-hidden bg-gray-800" style={{ aspectRatio: '1' }}>
        {thumbs?.baseline_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbs.baseline_url} alt="Baseline Landsat"
            className="absolute inset-0 w-full h-full object-cover" />
        )}
        {thumbs?.recent_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbs.recent_url} alt="Recent Landsat"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}
          />
        )}
        <div className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none" style={{ left: `${slider}%` }} />
        {/* Well location marker — always at image centre since thumbnail is centred on the point */}
        <div className="absolute pointer-events-none" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff', boxShadow: '0 0 0 3px rgba(239,68,68,0.4)' }} />
        </div>
        <span className="absolute bottom-1.5 left-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
          {thumbs?.baseline_year}
        </span>
        <span className="absolute bottom-1.5 right-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
          {thumbs?.recent_year}
        </span>
        <input
          type="range" min={0} max={100} value={slider}
          onChange={e => setSlider(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
        />
      </div>
      <p className="text-xs text-gray-600 mt-1.5 text-center">
        Landsat · {thumbs?.gap_years}-year gap · drag to compare
      </p>
    </div>
  );
}

function SatellitePanel({ lat, lng }: { lat: number; lng: number }) {
  const [status, setStatus]   = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [data, setData]       = useState<SatelliteResult | null>(null);
  const [errMsg, setErrMsg]   = useState('');
  const [tab, setTab]         = useState<'imagery' | 'ndvi' | 'methane'>('imagery');

  // Reset when the well changes
  useEffect(() => { setStatus('idle'); setData(null); setTab('imagery'); }, [lat, lng]);


  async function load() {
    setStatus('loading');
    try {
      const res = await fetch(`/api/satellite?lat=${lat}&lng=${lng}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setStatus('done');
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : 'Unknown error');
      setStatus('error');
    }
  }

  if (status === 'idle') return (
    <div className="mt-4 pt-4 border-t border-gray-700">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Satellite Analysis</p>

      {/* Imagery always available — no API call needed */}
      <div className="flex gap-1 mb-3">
        {(['imagery', 'ndvi', 'methane'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-1 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: tab === t ? '#4f46e5' : 'transparent',
              color:            tab === t ? '#fff' : '#9ca3af',
              border:           '1px solid ' + (tab === t ? '#4f46e5' : '#374151'),
            }}
          >
            {t === 'imagery' ? 'Imagery' : t === 'ndvi' ? 'Vegetation' : 'Methane'}
          </button>
        ))}
      </div>

      {tab === 'imagery' ? (
        <LandsatSlider lat={lat} lng={lng} />
      ) : (
        <>
          <button onClick={load}
            className="w-full py-2 rounded text-xs font-medium bg-indigo-700 hover:bg-indigo-600 transition-colors text-white"
          >
            Run GEE Analysis ↗
          </button>
          <p className="text-xs text-gray-600 mt-1.5 text-center">
            Landsat NDVI 2000–2003 vs 2023–2024 · Sentinel-5P CH₄
          </p>
        </>
      )}
    </div>
  );

  if (status === 'loading') return (
    <div className="mt-4 pt-4 border-t border-gray-700">
      <p className="text-xs text-gray-400 text-center animate-pulse">Querying Google Earth Engine…</p>
    </div>
  );

  if (status === 'error') return (
    <div className="mt-4 pt-4 border-t border-gray-700">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Satellite Analysis</p>
      <div className="p-2.5 bg-gray-800/60 border border-gray-700 rounded text-xs text-gray-400 mb-2">
        {errMsg.includes('503') || errMsg.includes('unavailable')
          ? <>GEE service not running. Start it with:<br /><code className="text-yellow-400">python satellite_service.py</code></>
          : errMsg}
      </div>
      <div className="flex gap-2">
        <button onClick={() => { setStatus('idle'); setTab('imagery'); }}
          className="text-xs text-gray-500 hover:text-white">
          ← Back to imagery
        </button>
        <button onClick={load} className="text-xs text-indigo-400 hover:text-white ml-auto">Retry</button>
      </div>
    </div>
  );

  const { ndvi, methane } = data!;

  return (
    <div className="mt-4 pt-4 border-t border-gray-700">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Satellite Analysis</p>

      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {(['imagery', 'ndvi', 'methane'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-1 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: tab === t ? '#4f46e5' : 'transparent',
              color:            tab === t ? '#fff' : '#9ca3af',
              border:           '1px solid ' + (tab === t ? '#4f46e5' : '#374151'),
            }}
          >
            {t === 'imagery' ? 'Imagery' : t === 'ndvi' ? 'Vegetation' : 'Methane'}
          </button>
        ))}
      </div>

      {/* ── Vegetation tab ── */}
      {tab === 'ndvi' && (
        <div className="space-y-2 text-xs">
          {ndvi.error ? (
            <p className="text-gray-500">{ndvi.error}</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-bold uppercase"
                  style={{
                    backgroundColor: NDVI_TYPE_COLOR[ndvi.anomaly_type ?? 'no_data'],
                    color: '#000',
                  }}
                >
                  {ndvi.anomaly_type?.replace(/_/g, ' ') ?? '—'}
                </span>
                {ndvi.score != null && ndvi.score > 0 && (
                  <span className="text-gray-400">score {ndvi.score}/100</span>
                )}
              </div>
              <Row label={`NDVI ${ndvi.baseline_years}`} value={ndvi.baseline?.toFixed(3) ?? '—'} />
              <Row label={`NDVI ${ndvi.recent_years}`}   value={ndvi.recent?.toFixed(3) ?? '—'} />
              <Row label="Absolute change"  value={ndvi.change != null ? ndvi.change.toFixed(3) : '—'} />
              <Row label="Relative change"  value={ndvi.relative_change != null ? `${(ndvi.relative_change * 100).toFixed(1)}%` : '—'} />
              <p className="text-gray-600 mt-2 leading-relaxed">
                Relative change compares the drop to the starting greenness — a 15% loss in dense forest
                is more significant than the same loss in sparse scrub.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Methane tab ── */}
      {tab === 'methane' && (
        <div className="space-y-2 text-xs">
          {methane.error ? (
            <p className="text-gray-500">{methane.error}</p>
          ) : (
            <>
              {methane.is_anomaly && (
                <div className="p-2 bg-orange-900/40 border border-orange-700/50 rounded text-orange-300 mb-2">
                  Elevated methane detected above local background
                </div>
              )}
              <Row label="Well CH₄ (ppb)"       value={methane.well_ppb?.toLocaleString() ?? '—'} highlight={methane.is_anomaly} />
              <Row label="Background CH₄ (ppb)" value={methane.background_ppb?.toLocaleString() ?? '—'} />
              <Row label="Anomaly ratio"         value={methane.anomaly_ratio?.toFixed(3) ?? '—'} highlight={methane.is_anomaly} />
              <p className="text-gray-600 mt-2 leading-relaxed">
                Sentinel-5P resolution is ~5.5 km — readings reflect the pixel,
                not just this well. Ratio &gt;1.05 is flagged as elevated.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Ohio OSIP imagery tab ── */}
      {tab === 'imagery' && <LandsatSlider lat={lat} lng={lng} />}
    </div>
  );
}

interface Props {
  well: WellDetail | null;
  selectedCounty: CountySummary | null;
  filters: Priority[];
  onFilterChange: (p: Priority) => void;
  onClose: () => void;
  onCloseCounty: () => void;
  nearYouResult: NearYouResult | null;
  onClearNearYou: () => void;
  onSelectWell: (well: WellDetail | null) => void;
}

const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const pct = value ?? 0;
  const color =
    pct >= 75 ? '#ef4444' : pct >= 55 ? '#f97316' : pct >= 35 ? '#eab308' : '#22c55e';
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1 text-gray-400">
        <span>{label}</span>
        <span className="font-mono text-white">{value ?? '—'}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function ImpactCallout({ well }: { well: WellDetail }) {
  const points: { text: string; color: string }[] = [];

  if (well.priority === 'critical') {
    points.push({ text: "One of Ohio's highest-priority wells for immediate action", color: 'text-red-400' });
  }
  if (well.within_protection_zone) {
    points.push({ text: 'Inside a drinking water protection zone — contamination could affect the public water supply', color: 'text-blue-400' });
  } else if (well.nearest_water_distance_m != null && well.nearest_water_distance_m < 500) {
    const m = Math.round(well.nearest_water_distance_m);
    points.push({ text: `${m}m from a drinking water source — closer than most city blocks`, color: 'text-blue-400' });
  }
  if (well.population_within_1km != null && well.population_within_1km > 1000) {
    points.push({ text: `~${well.population_within_1km.toLocaleString()} people live within 1km of this well`, color: 'text-gray-300' });
  }
  if (well.years_inactive != null && well.years_inactive > 30) {
    points.push({ text: `Dormant for ${well.years_inactive} years — longer than most Ohioans have been alive`, color: 'text-gray-400' });
  }
  if (well.operator_status === 'orphan_program' || well.operator_status === 'historic_owner') {
    points.push({ text: 'No responsible owner — plugging costs fall to Ohio taxpayers', color: 'text-orange-400' });
  }

  if (points.length === 0) return null;

  return (
    <div className="mb-4 p-3 bg-gray-800/60 rounded-lg border border-gray-700">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">What this means</p>
      <ul className="space-y-1.5">
        {points.map((p, i) => (
          <li key={i} className={`text-xs ${p.color} flex gap-1.5`}>
            <span className="shrink-0 mt-0.5">—</span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function fetchWellByApiNo(api_no: string): Promise<WellDetail | null> {
  const { data, error } = await supabase
    .from('well_map_view')
    .select('*')
    .eq('api_no', api_no.trim())
    .single();
  if (error || !data) return null;
  return {
    api_no:                   data.api_no,
    priority:                 data.priority,
    risk_score:               data.risk_score,
    water_risk_score:         data.water_risk_score,
    population_risk_score:    data.population_risk_score,
    inactivity_score:         data.inactivity_score,
    nearest_water_distance_m: data.nearest_water_distance_m,
    within_protection_zone:   data.within_protection_zone,
    operator_status:          data.operator_status,
    population_within_1km:    data.population_within_1km,
    population_within_5km:    data.population_within_5km,
    years_inactive:           data.years_inactive,
    well: {
      well_name: data.well_name,
      county:    data.county,
      status:    data.status,
      operator:  data.operator,
      well_type: data.well_type,
      lat:       data.lat,
      lng:       data.lng,
    },
  } as WellDetail;
}

function ApiLookup({ onSelectWell }: { onSelectWell: (w: WellDetail | null) => void }) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    const result = await fetchWellByApiNo(value);
    setLoading(false);
    if (!result) {
      setError('No scored well found for that API number.');
    } else {
      onSelectWell(result);
      setValue('');
      setError(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 pt-4 border-t border-gray-700">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Look up by API No</p>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setError(null); }}
          placeholder="e.g. 34009617340000"
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded text-xs bg-gray-800 text-white border border-gray-600 placeholder-gray-500 focus:outline-none focus:border-blue-400"
        />
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-colors text-white shrink-0"
        >
          {loading ? '…' : 'Go'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
    </form>
  );
}

export default function WellSidebar({ well, selectedCounty, filters, onFilterChange, onClose, onCloseCounty, nearYouResult, onClearNearYou, onSelectWell }: Props) {
  return (
    <div className="w-80 bg-gray-900 text-white flex flex-col h-full border-l border-gray-700">

      {/* Filter toggles — always visible */}
      <div className="p-4 border-b border-gray-700">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Show priorities</p>
        <div className="flex gap-2 flex-wrap">
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={() => onFilterChange(p)}
              className="px-3 py-1 rounded-full text-xs font-medium border transition-opacity"
              style={{
                borderColor: PRIORITY_COLOR[p],
                color: filters.includes(p) ? '#000' : PRIORITY_COLOR[p],
                backgroundColor: filters.includes(p) ? PRIORITY_COLOR[p] : 'transparent',
                opacity: filters.includes(p) ? 1 : 0.5,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Well detail — shown when a well is selected */}
      {well ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{well.well?.county} COUNTY</p>
              <h2 className="text-base font-semibold leading-tight">
                {well.well?.well_name ?? well.api_no}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{well.api_no}</p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white ml-2 text-lg leading-none">✕</button>
          </div>

          {/* Priority badge + Street View link */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div
              className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase"
              style={{ backgroundColor: PRIORITY_COLOR[well.priority], color: '#000' }}
            >
              {well.priority} — {well.risk_score}
            </div>
            <a
              href={`https://www.google.com/maps?cbll=${well.well?.lat},${well.well?.lng}&layer=c`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-3 py-1 rounded-full text-xs font-medium border border-gray-600 text-gray-300 hover:border-white hover:text-white transition-colors"
            >
              Street View ↗
            </a>
          </div>

          {/* Plain-language impact callout */}
          <ImpactCallout well={well} />

          {/* Score breakdown */}
          <div className="mb-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Risk scores</p>
            <ScoreBar label="Water risk"      value={well.water_risk_score} />
            <ScoreBar label="Population risk" value={well.population_risk_score} />
            <ScoreBar label="Inactivity"      value={well.inactivity_score} />
          </div>

          {/* Well metadata */}
          <div className="space-y-2 text-sm">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Details</p>
            <Row label="Status"       value={well.well?.status} />
            <Row label="Well type"    value={well.well?.well_type} />
            <Row label="Operator"     value={well.well?.operator} />
            <Row label="Oper. status" value={well.operator_status} highlight={well.operator_status === 'historic_owner'} />
            <Row label="Years inactive" value={well.years_inactive != null ? `${well.years_inactive} yrs` : 'Unknown'} />
            <Row label="Water distance" value={well.nearest_water_distance_m != null
              ? `${(well.nearest_water_distance_m / 1000).toFixed(1)} km` : '—'} />
            <Row label="In zone"      value={well.within_protection_zone ? 'Yes' : 'No'}
              highlight={well.within_protection_zone} />
            <Row label="Pop within 1km" value={well.population_within_1km?.toLocaleString() ?? '—'} />
            <Row label="Pop within 5km" value={well.population_within_5km?.toLocaleString() ?? '—'} />
          </div>

          {/* Live satellite analysis */}
          {well.well?.lat && well.well?.lng && (
            <SatellitePanel lat={well.well.lat} lng={well.well.lng} />
          )}
        </div>
      ) : selectedCounty ? (
        <CountyPanel county={selectedCounty} onClose={onCloseCounty} />
      ) : nearYouResult ? (
        <NearYouPanel result={nearYouResult} onClear={onClearNearYou} onSelectWell={onSelectWell} />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-gray-500 text-sm text-center">
            Search your address above, or click a county or well dot to inspect.
          </p>
          <ApiLookup onSelectWell={onSelectWell} />
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value?: string | number | null; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className={`text-right truncate ${highlight ? 'text-orange-400' : 'text-white'}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function formatCost(dollars: number | null): string {
  if (dollars == null) return '—';
  if (dollars >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(1)}B`;
  if (dollars >= 1_000_000)     return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000)         return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars}`;
}

function NearYouPanel({ result, onClear, onSelectWell }: { result: NearYouResult; onClear: () => void; onSelectWell: (w: WellDetail | null) => void }) {
  const highRisk = result.critical + result.high;
  const counts: Record<Priority, number> = {
    critical: result.critical,
    high:     result.high,
    medium:   result.medium,
    low:      result.low,
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Near You</p>
          <h2 className="text-base font-semibold leading-tight">{result.place_name}</h2>
        </div>
        <button onClick={onClear} className="text-gray-500 hover:text-white ml-2 text-lg leading-none">✕</button>
      </div>

      {result.total === 0 ? (
        <div className="p-3 bg-green-900/30 border border-green-700/50 rounded-lg">
          <p className="text-sm text-green-400 font-medium">No scored wells within 5 miles</p>
          <p className="text-xs text-gray-400 mt-1">Your immediate area has no flagged oil or gas wells.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 flex-wrap mb-4">
            {(Object.keys(counts) as Priority[]).map(p => {
              if (counts[p] === 0) return null;
              return (
                <div key={p} className="px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: PRIORITY_COLOR[p], color: '#000' }}>
                  {counts[p].toLocaleString()} {p}
                </div>
              );
            })}
          </div>

          <div className="space-y-2 mb-4">
            {result.critical > 0 && (
              <div className="p-2.5 bg-red-900/30 border border-red-700/40 rounded text-xs text-red-300">
                {result.critical} well{result.critical > 1 ? 's' : ''} within 5 miles require{result.critical === 1 ? 's' : ''} immediate plugging action
              </div>
            )}
            {result.in_zone && (
              <div className="p-2.5 bg-blue-900/30 border border-blue-700/40 rounded text-xs text-blue-300">
                At least one nearby well sits inside a drinking water protection zone
              </div>
            )}
            {result.max_pop_1km != null && result.max_pop_1km > 500 && (
              <div className="p-2.5 bg-gray-800/60 border border-gray-700/40 rounded text-xs text-gray-300">
                Up to {result.max_pop_1km.toLocaleString()} residents live within walking distance of the highest-exposure well nearby
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-gray-700">
            <p className="text-xs text-gray-500">{result.total.toLocaleString()} total wells within ~5 miles</p>
            {highRisk > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                {highRisk} ({Math.round(highRisk / result.total * 100)}%) are critical or high priority
              </p>
            )}
          </div>
        </>
      )}
      <ApiLookup onSelectWell={onSelectWell} />
    </div>
  );
}

function CountyPanel({ county, onClose }: { county: CountySummary; onClose: () => void }) {
  const score = county.avg_risk_score;
  const scoreColor =
    score == null ? '#6b7280'
    : score >= 35 ? '#ef4444'
    : score >= 25 ? '#f97316'
    : '#2563eb';

  const total = county.critical_count + county.high_count + county.medium_count + county.low_count;
  const pctNeedAction = county.total_wells > 0
    ? Math.round((total / county.total_wells) * 100)
    : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">COUNTY BREAKDOWN</p>
          <h2 className="text-base font-semibold leading-tight">{county.county}</h2>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white ml-2 text-lg leading-none">✕</button>
      </div>

      {/* Avg risk score badge */}
      <div
        className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase mb-3"
        style={{ backgroundColor: scoreColor, color: '#fff' }}
      >
        avg risk {score ?? '—'}
      </div>

      {/* Human context */}
      {pctNeedAction > 0 && (
        <p className="text-xs text-gray-400 mb-4">
          {pctNeedAction}% of this county&apos;s wells are flagged for attention
          {county.in_orphan_program > 0 && `, including ${county.in_orphan_program.toLocaleString()} with no responsible owner`}
        </p>
      )}

      {/* Priority pill counts */}
      <div className="mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Priority breakdown</p>
        <div className="flex gap-2 flex-wrap">
          {(['critical', 'high', 'medium', 'low'] as const).map(p => {
            const count = county[`${p}_count` as keyof CountySummary] as number;
            return (
              <div
                key={p}
                className="px-3 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: PRIORITY_COLOR[p], color: '#000' }}
              >
                {count.toLocaleString()} {p}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-2 text-sm">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Well counts</p>
        <Row label="Total wells"       value={county.total_wells.toLocaleString()} />
        <Row label="Scored wells"      value={county.scored_wells.toLocaleString()} />
        <Row label="Scored & ranked"   value={total > 0 ? total.toLocaleString() : '—'} />
        <Row label="In orphan program" value={county.in_orphan_program.toLocaleString()} highlight={county.in_orphan_program > 0} />
      </div>

      {/* Plugging cost estimate */}
      {county.cost_mid != null && county.cost_mid > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Est. plugging cost</p>
          <p className="text-lg font-bold text-emerald-400">{formatCost(county.cost_mid)}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Range: {formatCost(county.cost_low)} – {formatCost(county.cost_high)}
          </p>
          <p className="text-xs text-gray-600 mt-1">Based on well depth × industry avg rates</p>
        </div>
      )}
    </div>
  );
}
