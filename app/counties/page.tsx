'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

// 32 ARC Appalachian Ohio counties
const ARC_COUNTIES = new Set([
  'ADAMS','ASHTABULA','ATHENS','BELMONT','BROWN','CARROLL','CLERMONT',
  'COLUMBIANA','COSHOCTON','GALLIA','GUERNSEY','HARRISON','HIGHLAND',
  'HOCKING','HOLMES','JACKSON','JEFFERSON','KNOX','LAWRENCE','LICKING',
  'MEIGS','MONROE','MORGAN','MUSKINGUM','NOBLE','PERRY','PIKE','ROSS',
  'SCIOTO','TUSCARAWAS','VINTON','WASHINGTON',
]);

interface CountyRow {
  fips_code: string;
  county: string;
  cty_num: number;
  total_records: number;
  active_wells: number;
  historic_owner: number;
  producing: number;
  injection: number;
  storage: number;
  orphan: number;
  drilling: number;
  permitted: number;
  fi_wnf: number;
  fr: number;
  exp: number;
  pa: number;
  unk: number;
  drilled: number;
  cost_low: number;
  cost_mid: number;
  cost_high: number;
  // computed client-side
  potential_to_plug: number;
  pct_to_plug: number;
}

type SortKey = keyof Omit<CountyRow, 'fips_code' | 'county'>;

function formatCost(dollars: number): string {
  if (!dollars) return '—';
  if (dollars >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(1)}B`;
  if (dollars >= 1_000_000)     return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000)         return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars}`;
}

function computeDerived(row: Omit<CountyRow, 'pct_to_plug'>): CountyRow {
  // potential_to_plug comes from DB (distinct well count — no double counting)
  // pct_to_plug is derived here
  const pct = row.total_records > 0
    ? Math.round((row.potential_to_plug / row.total_records) * 1000) / 10
    : 0;
  return { ...row, pct_to_plug: pct };
}

const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'cty_num',          label: 'CTY #' },
  { key: 'total_records',    label: 'Total',       title: 'All records in RBDMS' },
  { key: 'potential_to_plug',label: 'To Plug',    title: 'Historic Owner + Orphan + FI WNF + Unknown + Well Drilled + Permit Expired — excludes already-plugged (P&A, FR)' },
  { key: 'pct_to_plug',      label: '% to Plug', title: 'To Plug ÷ Total Records × 100' },
  { key: 'active_wells',     label: 'Active',      title: 'Not P&A or Final Restoration' },
  { key: 'historic_owner',   label: 'Historic',    title: 'Operator = HISTORIC OWNER' },
  { key: 'producing',     label: 'Producing' },
  { key: 'injection',     label: 'Injection' },
  { key: 'storage',       label: 'Storage' },
  { key: 'orphan',        label: 'Orphan',   title: 'In ODNR orphan program' },
  { key: 'drilling',      label: 'Drilling' },
  { key: 'permitted',     label: 'Permitted' },
  { key: 'fi_wnf',        label: 'FI WNF',   title: 'Field Inspected, Well Not Found' },
  { key: 'fr',            label: 'FR',        title: 'Final Restoration (plugged + surface restored)' },
  { key: 'exp',           label: 'Exp',       title: 'Permit Expired' },
  { key: 'pa',            label: 'P&A',       title: 'Plugged and Abandoned' },
  { key: 'unk',           label: 'Unk',       title: 'Unknown status' },
  { key: 'drilled',       label: 'Drilled',   title: 'Well Drilled (no further status)' },
  { key: 'cost_mid',      label: 'Est. Cost', title: 'Midpoint plugging cost estimate based on well depth (low: <500ft=$20k, 500-2k=$50k, 2-5k=$110k, 5k+=$200k). Unknown depth treated as shallow.' },
];

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function CountiesPage() {
  const [rows, setRows]               = useState<CountyRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [appalachianOnly, setAppalachianOnly] = useState(false);
  const [sortKey, setSortKey]         = useState<SortKey>('total_records');
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    supabase
      .from('county_status_summary')
      .select('*')
      .then(({ data }) => {
        if (data) setRows((data as unknown as Omit<CountyRow,'pct_to_plug'>[]).map(computeDerived));
        setLoading(false);
      });
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = rows
    .filter(r => {
      if (appalachianOnly && !ARC_COUNTIES.has(r.county)) return false;
      if (search && !r.county.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDir === 'desc'
        ? (bv as number) - (av as number)
        : (av as number) - (bv as number);
    });

  // Totals row — sum all cols, then recompute derived fields
  const SKIP_SUM = new Set<SortKey>(['cty_num', 'cost_low', 'cost_mid', 'cost_high']);
  const totals = filtered.reduce<Record<SortKey, number>>(
    (acc, r) => {
      COLS.forEach(c => {
        if (!SKIP_SUM.has(c.key)) acc[c.key] = (acc[c.key] ?? 0) + (r[c.key] as number);
      });
      return acc;
    },
    {} as Record<SortKey, number>
  );
  if (totals.total_records > 0) {
    totals.pct_to_plug = Math.round((totals.potential_to_plug / totals.total_records) * 1000) / 10;
  }
  totals.cost_low  = filtered.reduce((s, r) => s + (r.cost_low  ?? 0), 0);
  totals.cost_mid  = filtered.reduce((s, r) => s + (r.cost_mid  ?? 0), 0);
  totals.cost_high = filtered.reduce((s, r) => s + (r.cost_high ?? 0), 0);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-tight">Ohio Well Data — County Summary</h1>
          {!loading && (
            <span className="text-xs text-gray-500">
              {filtered.length} of 88 counties
              {appalachianOnly ? ' · Appalachian' : ''}
            </span>
          )}
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/about"    className="text-xs text-gray-400 hover:text-white transition-colors">About</Link>
          <Link href="/"         className="text-xs text-gray-400 hover:text-white transition-colors">← Map</Link>
          <Link href="/table"    className="text-xs text-gray-400 hover:text-white transition-colors">Table</Link>
          <Link href="/facts"    className="text-xs text-gray-400 hover:text-white transition-colors">Facts</Link>
          <Link href="/impact"   className="text-xs text-gray-400 hover:text-white transition-colors">Impact</Link>
          <Link href="/emissions" className="text-xs text-gray-400 hover:text-white transition-colors">Emissions →</Link>
        </nav>
      </header>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <input
          type="text"
          placeholder="Search county…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-gray-400 w-44"
        />
        <button
          onClick={() => setAppalachianOnly(v => !v)}
          className="px-2 py-1 rounded text-xs font-medium border transition-colors"
          style={{
            borderColor:     '#a78bfa',
            color:           appalachianOnly ? '#000' : '#a78bfa',
            backgroundColor: appalachianOnly ? '#a78bfa' : 'transparent',
          }}
        >
          Appalachian only
        </button>
        <span className="text-xs text-gray-600 ml-2">
          Hover column headers for descriptions · Click to sort
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full border-collapse min-w-max">
          <thead className="sticky top-0 z-10 bg-gray-800">
            <tr>
              {/* ARC marker */}
              <th className="px-2 py-2 text-left border-b border-gray-700 w-4" style={{ fontSize: '10px' }} />
              {/* County */}
              <th
                className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-gray-700 cursor-pointer hover:text-white select-none"
                style={{ fontSize: '10px' }}
                onClick={() => handleSort('cty_num')}
              >
                County {sortKey === 'cty_num' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
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
              <tr><td colSpan={COLS.length + 2} className="text-center py-10 text-gray-500">Loading…</td></tr>
            ) : filtered.map((row, i) => {
              const isArc = ARC_COUNTIES.has(row.county);
              return (
                <tr
                  key={row.fips_code}
                  className={`${i % 2 === 1 ? 'bg-gray-900/40' : ''} hover:bg-gray-800/60 transition-colors`}
                >
                  {/* ARC dot */}
                  <td className="px-2 py-1 text-center">
                    {isArc && <span className="text-purple-400 text-xs" title="Appalachian county">●</span>}
                  </td>
                  {/* County name */}
                  <td className="px-3 py-1 font-medium whitespace-nowrap">
                    {titleCase(row.county)}
                  </td>
                  {COLS.map(col => (
                    <td key={col.key} className="px-2 py-1 font-mono text-right whitespace-nowrap">
                      <CellVal col={col.key} val={row[col.key] as number} row={row} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>

          {/* Totals footer */}
          {!loading && filtered.length > 0 && (
            <tfoot className="sticky bottom-0 bg-gray-800 border-t border-gray-600">
              <tr>
                <td />
                <td className="px-3 py-2 font-semibold text-xs text-gray-300 whitespace-nowrap">
                  TOTAL ({filtered.length})
                </td>
                {COLS.map(col => (
                  <td key={col.key} className="px-2 py-2 font-mono font-semibold text-right text-xs text-gray-300 whitespace-nowrap">
                    {col.key === 'cty_num'
                      ? '—'
                      : col.key === 'cost_mid'
                        ? <span className="text-emerald-400" title={`Low: ${formatCost(totals.cost_low)}  High: ${formatCost(totals.cost_high)}`}>
                            {formatCost(totals.cost_mid)}
                          </span>
                      : totals[col.key]?.toLocaleString() ?? '—'}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Cell renderer — highlights non-zero problem counts ───────────────────────

function CellVal({ col, val, row }: { col: SortKey; val: number; row: CountyRow }) {
  if (val === 0 || val == null) {
    return <span className="text-gray-700">—</span>;
  }

  // Color-code specific columns
  if (col === 'potential_to_plug') {
    const color = val > 1000 ? '#ef4444' : val > 500 ? '#f97316' : val > 100 ? '#eab308' : '#22c55e';
    return <span style={{ color }} className="font-semibold">{val.toLocaleString()}</span>;
  }
  if (col === 'pct_to_plug') {
    const color = val >= 50 ? '#ef4444' : val >= 30 ? '#f97316' : val >= 15 ? '#eab308' : '#22c55e';
    return <span style={{ color }} className="font-semibold">{val.toFixed(1)}%</span>;
  }
  if (col === 'historic_owner') return <span className="text-orange-400">{val.toLocaleString()}</span>;
  if (col === 'orphan')         return <span className="text-red-400">{val.toLocaleString()}</span>;
  if (col === 'fi_wnf')         return <span className="text-yellow-400">{val.toLocaleString()}</span>;
  if (col === 'unk')            return <span className="text-gray-400">{val.toLocaleString()}</span>;
  if (col === 'drilled')        return <span className="text-amber-400">{val.toLocaleString()}</span>;
  if (col === 'exp')            return <span className="text-yellow-300">{val.toLocaleString()}</span>;
  if (col === 'cost_mid') {
    const low  = row.cost_low;
    const high = row.cost_high;
    return (
      <span className="text-emerald-400 font-semibold" title={`Low: ${formatCost(low)}  High: ${formatCost(high)}`}>
        {formatCost(val)}
      </span>
    );
  }
  if (col === 'active_wells') {
    // Shade by proportion of total
    const pct = row.total_records > 0 ? val / row.total_records : 0;
    const color = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#eab308' : '#6b7280';
    return <span style={{ color }}>{val.toLocaleString()}</span>;
  }

  return <span className="text-gray-300">{val.toLocaleString()}</span>;
}
