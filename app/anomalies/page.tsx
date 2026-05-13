'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import SiteHeader from '@/components/SiteHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SignalRow {
  api_no: string;
  well_name: string | null;
  county: string | null;
  operator: string | null;
  status: string | null;
  lat: number | null;
  lng: number | null;
  land_cover: number | null;
  priority: 'critical' | 'high' | null;
  composite_risk_score: number | null;
  water_risk_score: number | null;
  population_risk_score: number | null;
  slope_ratio: number | null;
  mean_slope_well: number | null;
  mean_slope_bg: number | null;
  is_artificially_flat: boolean | null;
  terrain_risk_score: number | null;
  ch4_anomaly_ratio: number | null;
  ch4_is_anomaly: boolean | null;
  ch4_signal_source: string | null;
  thermal_anomaly_c: number | null;
  thermal_well_c: number | null;
  emissions_risk_score: number | null;
}

// Client-side augmentation
interface Row extends SignalRow {
  sig_flat: boolean;
  sig_ch4: boolean;
  sig_thermal: boolean;
  sig_terrain_hi: boolean;
  sig_emissions_hi: boolean;
  signal_count: number;
}

// Toggle keys — must match sig_* row fields 1:1
type SignalKey = 'sig_flat' | 'sig_ch4' | 'sig_thermal' | 'sig_terrain_hi' | 'sig_emissions_hi';

const SIGNAL_META: Record<SignalKey, { label: string; hint: string; color: string }> = {
  sig_flat:         { label: 'Flat',        hint: 'is_artificially_flat — pad vs 1,300 ft surroundings', color: '#fbbf24' },
  sig_ch4:          { label: 'CH4',         hint: 'ch4_is_anomaly — Sentinel-5P column above local bg', color: '#f87171' },
  sig_thermal:      { label: 'Thermal≥3.6°F', hint: 'thermal_anomaly_c ≥ 2 (≥ 3.6 °F Δ) — Landsat 9 summer composite', color: '#fb923c' },
  sig_terrain_hi:   { label: 'Terr≥50',     hint: 'terrain_risk_score ≥ 50',                            color: '#fcd34d' },
  sig_emissions_hi: { label: 'Emis≥50',     hint: 'emissions_risk_score ≥ 50',                          color: '#f43f5e' },
};

const SIGNAL_KEYS: SignalKey[] = ['sig_flat', 'sig_ch4', 'sig_thermal', 'sig_terrain_hi', 'sig_emissions_hi'];

// WorldCover 2021 land cover classes
const LAND_COVER_TYPES: Record<number, string> = {
  10: 'Tree cover',
  20: 'Shrubland',
  30: 'Grassland',
  40: 'Cropland',
  50: 'Built-up',
  60: 'Bare/sparse vegetation',
  70: 'Snow and ice',
  80: 'Permanent water',
  90: 'Herbaceous wetland',
  95: 'Mangroves',
  100: 'Moss and lichen',
};

const LAND_COVER_CODES = Object.keys(LAND_COVER_TYPES).map(Number).sort((a, b) => a - b);

function computeSignals(r: SignalRow): Row {
  const sig_flat         = !!r.is_artificially_flat;
  const sig_ch4          = !!r.ch4_is_anomaly;
  const sig_thermal      = (r.thermal_anomaly_c    ?? 0) >= 2;
  const sig_terrain_hi   = (r.terrain_risk_score   ?? 0) >= 50;
  const sig_emissions_hi = (r.emissions_risk_score ?? 0) >= 50;
  const signal_count =
    (sig_flat ? 1 : 0) +
    (sig_ch4 ? 1 : 0) +
    (sig_thermal ? 1 : 0) +
    (sig_terrain_hi ? 1 : 0) +
    (sig_emissions_hi ? 1 : 0);
  return { ...r, sig_flat, sig_ch4, sig_thermal, sig_terrain_hi, sig_emissions_hi, signal_count };
}

function titleCase(s: string | null) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function priorityColor(p: string | null): string {
  if (p === 'critical') return '#ef4444';
  if (p === 'high')     return '#f97316';
  return '#6b7280';
}

// ── Column definitions ────────────────────────────────────────────────────────

type SortKey =
  | 'signal_count'
  | 'composite_risk_score'
  | 'water_risk_score'
  | 'population_risk_score'
  | 'terrain_risk_score'
  | 'emissions_risk_score'
  | 'ch4_anomaly_ratio'
  | 'thermal_anomaly_c'
  | 'slope_ratio';

const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'signal_count',         label: 'Sig#',     title: 'Count of anomaly flags this well trips (0-5)' },
  { key: 'composite_risk_score', label: 'Score',    title: 'Composite risk score (0-100)' },
  { key: 'water_risk_score',     label: 'Water',    title: 'Water dimension score' },
  { key: 'population_risk_score',label: 'Pop',      title: 'Population dimension score' },
  { key: 'terrain_risk_score',   label: 'Terr',     title: 'Terrain dimension score' },
  { key: 'emissions_risk_score', label: 'Emis',     title: 'Emissions dimension score' },
  { key: 'ch4_anomaly_ratio',    label: 'CH4×',     title: 'ch4_well / ch4_bg — ratio > 1 means above background' },
  { key: 'thermal_anomaly_c',    label: 'Therm Δ°F',title: 'thermal_well − thermal_bg (°F Δ)' },
  { key: 'slope_ratio',          label: 'Slope',    title: 'mean_slope_well / mean_slope_bg — low = flat pad' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnomaliesPage() {
  const [rows, setRows]       = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [minSignals, setMinSignals]             = useState(1);
  const [selectedLandCovers, setSelectedLandCovers] = useState<Set<number>>(new Set());
  const [activeSignals, setActiveSignals]       = useState<Record<SignalKey, boolean>>({
    sig_flat: true, sig_ch4: true, sig_thermal: true, sig_terrain_hi: true, sig_emissions_hi: true,
  });
  const [sortKey, setSortKey] = useState<SortKey>('signal_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    supabase
      .from('priority_remote_signals')
      .select('*')
      .then(({ data }) => {
        if (data) {
          const mapped = (data as unknown as SignalRow[]).map(computeSignals);
          setRows(mapped);
        }
        setLoading(false);
      });
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function toggleSignal(k: SignalKey) {
    setActiveSignals(s => ({ ...s, [k]: !s[k] }));
  }

  const filtered = useMemo(() => {
    const activeKeys = SIGNAL_KEYS.filter(k => activeSignals[k]);
    return rows
      .filter(r => {
        if (showCriticalOnly && r.priority !== 'critical') return false;
        // Must hit at least one *active* signal AND satisfy minSignals threshold.
        const hitCount = activeKeys.reduce((acc, k) => acc + (r[k] ? 1 : 0), 0);
        if (hitCount === 0) return false;
        if (r.signal_count < minSignals) return false;
        // Land cover filter: if selected, must match one of the selected types
        if (selectedLandCovers.size > 0 && !selectedLandCovers.has(r.land_cover ?? -1)) return false;
        if (search) {
          const s = search.toLowerCase();
          const hay = [r.api_no, r.well_name, r.county, r.operator]
            .filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const av = (a[sortKey] ?? -Infinity) as number;
        const bv = (b[sortKey] ?? -Infinity) as number;
        if (av === bv) {
          // tiebreaker: composite DESC
          const ac = a.composite_risk_score ?? 0;
          const bc = b.composite_risk_score ?? 0;
          return bc - ac;
        }
        return sortDir === 'desc' ? bv - av : av - bv;
      });
  }, [rows, activeSignals, showCriticalOnly, minSignals, selectedLandCovers, search, sortKey, sortDir]);

  // Header counts — independent of sort/search, respects only signal+priority filters
  const totalUniverse = rows.length;
  const critCount     = rows.filter(r => r.priority === 'critical').length;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <SiteHeader
        title="Anomalies"
        leftExtra={!loading && (
          <span>{filtered.length.toLocaleString()} matching · {totalUniverse.toLocaleString()} critical+high wells total</span>
        )}
      />

      {/* ── Explanation banner ─────────────────────────────────────────── */}
      {!loading && (
        <div className="px-5 py-2 bg-gray-900 border-b border-gray-800 text-xs text-gray-400">
          Wells with priority = <span className="text-red-400">critical</span> or <span className="text-orange-400">high</span> that show at least one remote-sensing anomaly
          (satellite terrain / CH4 / thermal signal above local background).
          <span className="text-gray-600 ml-2">{critCount} critical in universe · toggle signals below.</span>
        </div>
      )}

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0 flex-wrap">
        <input
          type="text"
          placeholder="Search api / name / county / operator…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-gray-400 w-64"
        />

        <button
          onClick={() => setShowCriticalOnly(v => !v)}
          className="px-2 py-1 rounded text-xs font-medium border transition-colors"
          style={{
            borderColor:     '#ef4444',
            color:           showCriticalOnly ? '#000' : '#ef4444',
            backgroundColor: showCriticalOnly ? '#ef4444' : 'transparent',
          }}
        >
          Critical only
        </button>

        <span className="text-gray-700">│</span>

        {SIGNAL_KEYS.map(k => {
          const on = activeSignals[k];
          const meta = SIGNAL_META[k];
          return (
            <button
              key={k}
              onClick={() => toggleSignal(k)}
              title={meta.hint}
              className="px-2 py-1 rounded text-xs font-medium border transition-colors"
              style={{
                borderColor:     meta.color,
                color:           on ? '#000' : meta.color,
                backgroundColor: on ? meta.color : 'transparent',
                opacity:         on ? 1 : 0.65,
              }}
            >
              {meta.label}
            </button>
          );
        })}

        <span className="text-gray-700">│</span>

        <label className="flex items-center gap-2 text-xs text-gray-400">
          <span>Min signals</span>
          <select
            value={minSignals}
            onChange={e => setMinSignals(Number(e.target.value))}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
          >
            <option value={1}>≥1 (any)</option>
            <option value={2}>≥2</option>
            <option value={3}>≥3</option>
            <option value={4}>≥4</option>
          </select>
        </label>

        <span className="text-gray-700">│</span>

        <label className="flex items-center gap-2 text-xs text-gray-400">
          <span>Land type</span>
          <select
            multiple
            value={Array.from(selectedLandCovers).map(String)}
            onChange={e => {
              const selected = new Set<number>();
              for (const opt of e.currentTarget.selectedOptions) {
                selected.add(Number(opt.value));
              }
              setSelectedLandCovers(selected);
            }}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
            size={Math.min(8, LAND_COVER_CODES.length)}
          >
            {LAND_COVER_CODES.map(code => (
              <option key={code} value={code}>
                {code}: {LAND_COVER_TYPES[code]}
              </option>
            ))}
          </select>
        </label>

        <span className="text-xs text-gray-600 ml-2">
          Click signal chips to toggle · Click headers to sort
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full border-collapse min-w-max">
          <thead className="sticky top-0 z-10 bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700" style={{ fontSize: '10px' }}>Well</th>
              <th className="px-2 py-2 text-left font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700" style={{ fontSize: '10px' }}>County</th>
              <th className="px-2 py-2 text-left font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700" style={{ fontSize: '10px' }}>Operator</th>
              <th className="px-2 py-2 text-left font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700" style={{ fontSize: '10px' }}>Priority</th>
              {COLS.map(col => (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={() => handleSort(col.key)}
                  className="px-2 py-2 text-right font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700 cursor-pointer hover:text-white select-none"
                  style={{ fontSize: '10px' }}
                >
                  {col.label}{sortKey === col.key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
              <th className="px-2 py-2 text-left font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700" style={{ fontSize: '10px' }}>Signals</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length + 5} className="text-center py-10 text-gray-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={COLS.length + 5} className="text-center py-10 text-gray-500">No wells match filters.</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.api_no} className={`${i % 2 === 1 ? 'bg-gray-900/40' : ''} hover:bg-gray-800/60 transition-colors`}>
                <td className="px-3 py-1 font-mono whitespace-nowrap">
                  <Link href={`/wells/${encodeURIComponent(r.api_no)}`} className="hover:underline">
                    <div className="text-gray-200 hover:text-white">{r.well_name ?? r.api_no}</div>
                    <div className="text-[9px] text-gray-600">{r.api_no}</div>
                  </Link>
                </td>
                <td className="px-2 py-1 whitespace-nowrap text-gray-300">{titleCase(r.county)}</td>
                <td className="px-2 py-1 whitespace-nowrap max-w-[14rem] truncate" title={r.operator ?? ''}>
                  {r.operator ? (
                    <Link
                      href={`/operators/${encodeURIComponent(r.operator)}`}
                      className="text-gray-200 hover:text-white hover:underline"
                    >
                      {r.operator}
                    </Link>
                  ) : <span className="text-gray-700">—</span>}
                </td>
                <td className="px-2 py-1">
                  <span
                    className="px-1.5 py-0.5 text-[10px] rounded uppercase tracking-wide font-semibold"
                    style={{ background: priorityColor(r.priority), color: '#000' }}
                  >
                    {r.priority}
                  </span>
                </td>

                {/* Numeric columns */}
                <td className="px-2 py-1 font-mono text-right font-semibold" style={{ color: r.signal_count >= 3 ? '#f43f5e' : r.signal_count >= 2 ? '#f97316' : '#fbbf24' }}>
                  {r.signal_count}
                </td>
                <NumCell val={r.composite_risk_score} fmt={v => v.toFixed(0)} color={scoreColor(r.composite_risk_score)} />
                <NumCell val={r.water_risk_score}      fmt={v => v.toFixed(0)} color={scoreColor(r.water_risk_score)} />
                <NumCell val={r.population_risk_score} fmt={v => v.toFixed(0)} color={scoreColor(r.population_risk_score)} />
                <NumCell val={r.terrain_risk_score}    fmt={v => v.toFixed(0)} color={r.sig_terrain_hi ? '#fbbf24' : '#6b7280'} />
                <NumCell val={r.emissions_risk_score}  fmt={v => v.toFixed(0)} color={r.sig_emissions_hi ? '#f43f5e' : '#6b7280'} />
                <NumCell val={r.ch4_anomaly_ratio}     fmt={v => v.toFixed(2)} color={r.sig_ch4 ? '#f87171' : '#6b7280'} />
                <NumCell val={r.thermal_anomaly_c}     fmt={v => v.toFixed(1)} color={r.sig_thermal ? '#fb923c' : '#6b7280'} />
                <NumCell val={r.slope_ratio}           fmt={v => v.toFixed(2)} color={r.sig_flat ? '#fbbf24' : '#6b7280'} />

                {/* Signal chips */}
                <td className="px-2 py-1 whitespace-nowrap">
                  {SIGNAL_KEYS.filter(k => r[k]).map(k => (
                    <span
                      key={k}
                      className="inline-block mr-1 px-1.5 py-0.5 text-[9px] rounded uppercase tracking-wide font-semibold align-middle"
                      style={{ background: SIGNAL_META[k].color, color: '#000' }}
                    >
                      {SIGNAL_META[k].label}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NumCell({ val, fmt, color }: { val: number | null; fmt: (v: number) => string; color: string }) {
  if (val == null) return <td className="px-2 py-1 font-mono text-right text-gray-700">—</td>;
  return <td className="px-2 py-1 font-mono text-right" style={{ color }}>{fmt(val)}</td>;
}

function scoreColor(v: number | null): string {
  if (v == null) return '#374151';
  if (v >= 75) return '#ef4444';
  if (v >= 50) return '#f97316';
  if (v >= 25) return '#eab308';
  return '#9ca3af';
}
