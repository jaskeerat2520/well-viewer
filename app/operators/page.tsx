'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getCached, setCached } from '@/lib/idbCache';
import SiteHeader from '@/components/SiteHeader';

const OPERATORS_LIST_KEY = 'operators_list';
const OPERATORS_LIST_VERSION = 1;
const TTL_24H = 24 * 60 * 60 * 1000;

interface OperatorRow {
  operator: string;
  total_wells: number;
  plug_candidates: number;
  plugged_wells: number;
  active_producers: number;
  aging_producers: number;
  zombie_producers: number;
  paperwork_producers: number;
  orphan_program_wells: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  scored_wells: number;
  counties_count: number;
  avg_composite: number | null;
  max_composite: number | null;
  // computed client-side
  pct_plug: number;
  hidden_orphans: number;  // zombie + paperwork — Producing on paper, not really
}

type SortKey = keyof Omit<OperatorRow, 'operator'>;

const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'total_wells',          label: 'Wells',     title: 'All wells ever attributed to this operator' },
  { key: 'plug_candidates',      label: 'Plug Cand', title: 'Wells in the scoring pool that are NOT currently active producers — the real plugging liability' },
  { key: 'pct_plug',             label: '% Plug',    title: 'Plug Candidates ÷ Total × 100 — share of operator’s wells that still need plugging' },
  { key: 'active_producers',     label: 'Active',    title: 'Status = Producing AND last nonzero production year ≥ 2020 — real operating wells, not plug candidates' },
  { key: 'hidden_orphans',       label: 'Hidden',    title: 'Wells with status = Producing but no recent output — likely hidden orphans' },
  { key: 'orphan_program_wells', label: 'Orphan',    title: 'In ODNR orphan program' },
  { key: 'critical',             label: 'Critical',  title: 'Priority = critical (composite ≥ 75)' },
  { key: 'high',                 label: 'High',      title: 'Priority = high (composite 50–75)' },
  { key: 'medium',               label: 'Medium' },
  { key: 'low',                  label: 'Low' },
  { key: 'avg_composite',        label: 'Avg Score', title: 'Mean composite risk score across scored wells (0–100)' },
  { key: 'max_composite',        label: 'Max Score', title: 'Highest composite risk score among this operator’s wells' },
  { key: 'counties_count',       label: 'Counties',  title: 'Distinct Ohio counties where this operator has wells' },
];

type BaseRow = Omit<OperatorRow, 'pct_plug' | 'hidden_orphans'>;

function computeDerived(row: BaseRow): OperatorRow {
  const pct = row.total_wells > 0
    ? Math.round((row.plug_candidates / row.total_wells) * 1000) / 10
    : 0;
  return {
    ...row,
    pct_plug: pct,
    hidden_orphans: (row.zombie_producers ?? 0) + (row.paperwork_producers ?? 0),
  };
}

export default function OperatorsPage() {
  const [rows, setRows]                 = useState<OperatorRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [hideHistoric, setHideHistoric] = useState(false);
  const [minWells, setMinWells]         = useState(10);
  const [sortKey, setSortKey]           = useState<SortKey>('plug_candidates');
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached = await getCached<OperatorRow[]>(OPERATORS_LIST_KEY, OPERATORS_LIST_VERSION, TTL_24H);
      if (cancelled) return;
      if (cached) {
        setRows(cached);
        setLoading(false);
        return;
      }
      const { data } = await supabase.from('operator_risk_summary').select('*');
      if (cancelled) return;
      if (data) {
        const mapped = (data as unknown as BaseRow[]).map(computeDerived);
        setRows(mapped);
        await setCached(OPERATORS_LIST_KEY, OPERATORS_LIST_VERSION, mapped);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => rows
    .filter(r => {
      if (hideHistoric && r.operator === 'HISTORIC OWNER') return false;
      if (r.total_wells < minWells) return false;
      if (search && !r.operator.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return sortDir === 'desc' ? bv - av : av - bv;
    }),
    [rows, search, hideHistoric, minWells, sortKey, sortDir]);

  // Headline banner stats — computed from unfiltered rows so they stay stable
  const historic       = rows.find(r => r.operator === 'HISTORIC OWNER');
  const namedOperators = rows.filter(r => r.operator !== 'HISTORIC OWNER');
  const namedWells     = namedOperators.reduce((s, r) => s + r.total_wells, 0);
  const namedPlugCandidates = namedOperators.reduce((s, r) => s + r.plug_candidates, 0);
  const namedHiddenOrphans  = namedOperators.reduce((s, r) => s + r.hidden_orphans,  0);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <SiteHeader
        title="Operators"
        leftExtra={!loading && (
          <span>
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} operators
            {hideHistoric ? ' · hiding historic' : ''}
          </span>
        )}
      />

      {/* ── Callout banner ─────────────────────────────────────────────── */}
      {!loading && historic && (
        <div className="flex items-stretch gap-px bg-gray-700 border-b border-gray-700 text-xs shrink-0">
          <div className="flex-1 bg-gray-900 px-4 py-3">
            <div className="text-gray-500 uppercase tracking-wider" style={{ fontSize: '10px' }}>Historic Owner (no known party)</div>
            <div className="text-orange-400 font-mono font-semibold mt-1">
              {historic.total_wells.toLocaleString()} wells · {historic.plug_candidates.toLocaleString()} plug candidates · {historic.counties_count} counties
            </div>
            <div className="text-gray-500 mt-1">These wells have no identifiable owner in the RBDMS — the public is the default liability holder.</div>
          </div>
          <div className="flex-1 bg-gray-900 px-4 py-3">
            <div className="text-gray-500 uppercase tracking-wider" style={{ fontSize: '10px' }}>Named operators</div>
            <div className="text-gray-200 font-mono font-semibold mt-1">
              {namedOperators.length.toLocaleString()} operators · {namedWells.toLocaleString()} wells
            </div>
            <div className="text-gray-500 mt-1">
              Plug candidates in private hands: <span className="text-yellow-400 font-mono">{namedPlugCandidates.toLocaleString()}</span>
              {' · '}
              Hidden orphans (zombie+paper): <span className="text-rose-400 font-mono">{namedHiddenOrphans.toLocaleString()}</span>
            </div>
          </div>
          <div className="flex-1 bg-gray-900 px-4 py-3">
            <div className="text-gray-500 uppercase tracking-wider" style={{ fontSize: '10px' }}>How to read this page</div>
            <div className="text-gray-400 mt-1">
              <span className="text-white">Plug Cand</span> excludes recently-producing wells — it&apos;s real plug liability, not a bookkeeping count.
              {' '}<span className="text-white">Hidden</span> surfaces operators whose &ldquo;Producing&rdquo; wells have no recent production.
            </div>
          </div>
        </div>
      )}

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <input
          type="text"
          placeholder="Search operator…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-gray-400 w-56"
        />
        <button
          onClick={() => setHideHistoric(v => !v)}
          className="px-2 py-1 rounded text-xs font-medium border transition-colors"
          style={{
            borderColor:     '#fb923c',
            color:           hideHistoric ? '#000' : '#fb923c',
            backgroundColor: hideHistoric ? '#fb923c' : 'transparent',
          }}
        >
          Hide HISTORIC OWNER
        </button>
        <label className="flex items-center gap-2 text-xs text-gray-400 ml-2">
          <span>Min wells</span>
          <select
            value={minWells}
            onChange={e => setMinWells(Number(e.target.value))}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
          >
            <option value={0}>0</option>
            <option value={10}>10</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </label>
        <span className="text-xs text-gray-600 ml-2">
          Hover column headers for descriptions · Click to sort
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full border-collapse min-w-max">
          <thead className="sticky top-0 z-10 bg-gray-800">
            <tr>
              <th
                className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700 cursor-pointer hover:text-white select-none"
                style={{ fontSize: '10px' }}
                onClick={() => {
                  if (sortKey === 'total_wells') setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                  else { setSortKey('total_wells'); setSortDir('desc'); }
                }}
              >
                Operator
              </th>
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length + 1} className="text-center py-10 text-gray-500">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={COLS.length + 1} className="text-center py-10 text-gray-500">No operators match filters.</td></tr>
            ) : filtered.map((row, i) => {
              const isHistoric = row.operator === 'HISTORIC OWNER';
              return (
                <tr
                  key={row.operator}
                  className={`${i % 2 === 1 ? 'bg-gray-900/40' : ''} hover:bg-gray-800/60 transition-colors`}
                >
                  <td className="px-3 py-1 font-medium whitespace-nowrap max-w-sm truncate" title={row.operator}>
                    {isHistoric && (
                      <span className="inline-block mr-2 px-1.5 py-0.5 text-[9px] rounded bg-orange-500/20 text-orange-300 border border-orange-500/40 align-middle">
                        HISTORIC
                      </span>
                    )}
                    <Link
                      href={`/operators/${encodeURIComponent(row.operator)}`}
                      className={`${isHistoric ? 'text-orange-300' : 'text-gray-200'} hover:text-white hover:underline transition-colors`}
                    >
                      {row.operator}
                    </Link>
                  </td>
                  {COLS.map(col => (
                    <td key={col.key} className="px-2 py-1 font-mono text-right whitespace-nowrap">
                      <CellVal col={col.key} val={row[col.key] as number | null} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Cell renderer — highlights non-zero problem counts ───────────────────────
function CellVal({ col, val }: { col: SortKey; val: number | null }) {
  if (val === 0 || val == null) {
    return <span className="text-gray-700">—</span>;
  }

  if (col === 'pct_plug') {
    const color = val >= 95 ? '#ef4444' : val >= 80 ? '#f97316' : val >= 50 ? '#eab308' : '#22c55e';
    return <span style={{ color }} className="font-semibold">{val.toFixed(1)}%</span>;
  }
  if (col === 'plug_candidates') {
    const color = val >= 1000 ? '#ef4444' : val >= 200 ? '#f97316' : val >= 50 ? '#eab308' : '#9ca3af';
    return <span style={{ color }} className="font-semibold">{val.toLocaleString()}</span>;
  }
  if (col === 'hidden_orphans') {
    // zombie+paperwork — hidden plug liability. Red even at smaller magnitudes
    // because this is where overlooked orphans lurk.
    const color = val >= 100 ? '#f43f5e' : val >= 20 ? '#f97316' : '#eab308';
    return <span style={{ color }} className="font-semibold">{val.toLocaleString()}</span>;
  }
  if (col === 'active_producers') {
    return <span className="text-green-400">{val.toLocaleString()}</span>;
  }
  if (col === 'critical')             return <span className="text-red-400 font-semibold">{val.toLocaleString()}</span>;
  if (col === 'high')                 return <span className="text-orange-400 font-semibold">{val.toLocaleString()}</span>;
  if (col === 'medium')               return <span className="text-yellow-400">{val.toLocaleString()}</span>;
  if (col === 'low')                  return <span className="text-gray-400">{val.toLocaleString()}</span>;
  if (col === 'orphan_program_wells') return <span className="text-red-300">{val.toLocaleString()}</span>;
  if (col === 'avg_composite' || col === 'max_composite') {
    const color = val >= 50 ? '#ef4444' : val >= 25 ? '#f97316' : val >= 15 ? '#eab308' : '#9ca3af';
    return <span style={{ color }}>{val.toFixed(1)}</span>;
  }
  return <span className="text-gray-300">{val.toLocaleString()}</span>;
}
