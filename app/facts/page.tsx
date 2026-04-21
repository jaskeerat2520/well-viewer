'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { PRIORITY_COLOR } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FactSummary {
  total_wells: number;
  in_orphan_program: number;
  total_scored: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  avg_risk_score: number | null;
}

function formatCost(dollars: number | null): string {
  if (dollars == null) return '—';
  if (dollars >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(1)}B`;
  if (dollars >= 1_000_000)     return `$${(dollars / 1_000_000).toFixed(1)}M`;
  return `$${(dollars / 1_000).toFixed(0)}K`;
}

interface StatusStat {
  status: string;
  count: number;
}

interface CountyRow {
  county: string;
  total_wells: number;
  scored_wells: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  avg_risk_score: number | null;
  in_orphan_program: number;
}

type SortKey = keyof Omit<CountyRow, 'county'>;

const STATUS_HIGHLIGHT: Record<string, string> = {
  'Orphan Well - Ready':   '#ef4444',
  'Orphan Well - Pending': '#f97316',
  'Permit Expired':        '#eab308',
  'Producing':             '#22c55e',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color: color ?? '#fff' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function SortHeader({
  label, sortKey, current, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white select-none whitespace-nowrap"
      onClick={() => onSort(sortKey)}
    >
      {label} {active ? (dir === 'desc' ? '▼' : '▲') : ''}
    </th>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FactsPage() {
  const [summary, setSummary]     = useState<FactSummary | null>(null);
  const [statuses, setStatuses]   = useState<StatusStat[]>([]);
  const [counties, setCounties]   = useState<CountyRow[]>([]);
  const [sortKey, setSortKey]     = useState<SortKey>('total_wells');
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading]     = useState(true);
  const [costTotals, setCostTotals] = useState<{ low: number; mid: number; high: number } | null>(null);

  useEffect(() => {
    async function load() {
      const [summaryRes, statusRes, countyRes, costRes] = await Promise.all([
        supabase.from('fact_summary').select('*').single(),
        supabase.from('well_status_stats').select('*'),
        supabase.from('county_map_view').select(
          'county,total_wells,scored_wells,critical_count,high_count,medium_count,low_count,avg_risk_score,in_orphan_program'
        ),
        supabase.from('county_map_view').select('cost_low,cost_mid,cost_high'),
      ]);
      if (summaryRes.data)  setSummary(summaryRes.data as FactSummary);
      if (statusRes.data)   setStatuses(statusRes.data as StatusStat[]);
      if (countyRes.data)   setCounties(countyRes.data.filter(r => r.county) as CountyRow[]);
      if (costRes.data) {
        const rows = costRes.data as { cost_low: number; cost_mid: number; cost_high: number }[];
        setCostTotals({
          low:  rows.reduce((s, r) => s + (r.cost_low  ?? 0), 0),
          mid:  rows.reduce((s, r) => s + (r.cost_mid  ?? 0), 0),
          high: rows.reduce((s, r) => s + (r.cost_high ?? 0), 0),
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sortedCounties = [...counties].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const totalWells = summary?.total_wells ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-700">
        <h1 className="text-sm font-semibold tracking-tight">Ohio Well Risk — Facts</h1>
        <nav className="flex items-center gap-4">
          <Link href="/about"    className="text-xs text-gray-400 hover:text-white transition-colors">About</Link>
          <Link href="/"         className="text-xs text-gray-400 hover:text-white transition-colors">← Map</Link>
          <Link href="/table"    className="text-xs text-gray-400 hover:text-white transition-colors">Table</Link>
          <Link href="/counties" className="text-xs text-gray-400 hover:text-white transition-colors">Counties</Link>
          <Link href="/impact"   className="text-xs text-gray-400 hover:text-white transition-colors">Impact</Link>
          <Link href="/emissions" className="text-xs text-gray-400 hover:text-white transition-colors">Emissions →</Link>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-10">

        {loading && (
          <p className="text-gray-500 text-sm">Loading…</p>
        )}

        {/* ── Section 1: Statewide totals ──────────────────────────────────── */}
        {summary && (
          <section>
            <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-4">Statewide totals</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatCard label="Total wells"     value={summary.total_wells} />
              <StatCard label="Scored wells"    value={summary.total_scored} />
              <StatCard label="Orphan program"  value={summary.in_orphan_program} color="#f97316" />
              <StatCard label="Avg risk score"  value={summary.avg_risk_score ?? '—'} color="#a78bfa" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Critical" value={summary.critical_count} color={PRIORITY_COLOR.critical} />
              <StatCard label="High"     value={summary.high_count}     color={PRIORITY_COLOR.high} />
              <StatCard label="Medium"   value={summary.medium_count}   color={PRIORITY_COLOR.medium} />
              <StatCard label="Low"      value={summary.low_count}      color={PRIORITY_COLOR.low} />
            </div>

            {costTotals && (
              <div className="bg-gray-800 rounded-lg p-4 border border-emerald-800 mt-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Statewide plugging cost estimate</p>
                <p className="text-3xl font-bold text-emerald-400">{formatCost(costTotals.mid)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Range: {formatCost(costTotals.low)} – {formatCost(costTotals.high)} &nbsp;·&nbsp; Based on well depth × industry avg rates
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── Section 2: Status breakdown ──────────────────────────────────── */}
        {statuses.length > 0 && (
          <section>
            <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-4">Wells by status</h2>
            <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Count</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">% of total</th>
                    <th className="px-4 py-2 w-48"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {statuses.map(row => {
                    const pct = totalWells > 0 ? (row.count / totalWells) * 100 : 0;
                    const highlight = STATUS_HIGHLIGHT[row.status];
                    return (
                      <tr key={row.status} className="hover:bg-gray-800/50">
                        <td className="px-4 py-2 font-medium" style={{ color: highlight ?? '#fff' }}>
                          {row.status}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{row.count.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-gray-400">{pct.toFixed(1)}%</td>
                        <td className="px-4 py-2">
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div
                              className="h-1.5 rounded-full"
                              style={{ width: `${Math.min(pct * 3, 100)}%`, backgroundColor: highlight ?? '#4b5563' }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Section 3: County rankings ───────────────────────────────────── */}
        {counties.length > 0 && (
          <section>
            <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-4">
              County rankings — click a column header to sort
            </h2>
            <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">County</th>
                    <SortHeader label="Total wells"    sortKey="total_wells"      current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Scored"         sortKey="scored_wells"     current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Critical"       sortKey="critical_count"   current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="High"           sortKey="high_count"       current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Medium"         sortKey="medium_count"     current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Low"            sortKey="low_count"        current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Avg risk"       sortKey="avg_risk_score"   current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Orphan program" sortKey="in_orphan_program" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {sortedCounties.map(row => (
                    <tr key={row.county} className="hover:bg-gray-800/50">
                      <td className="px-3 py-2 font-medium capitalize">{row.county.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.total_wells.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">{row.scored_wells.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.critical_count > 0 ? PRIORITY_COLOR.critical : '#4b5563' }}>{row.critical_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.high_count > 0 ? PRIORITY_COLOR.high : '#4b5563' }}>{row.high_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.medium_count > 0 ? PRIORITY_COLOR.medium : '#4b5563' }}>{row.medium_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.low_count > 0 ? PRIORITY_COLOR.low : '#4b5563' }}>{row.low_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-purple-400">{row.avg_risk_score ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.in_orphan_program > 0 ? '#f97316' : '#4b5563' }}>{row.in_orphan_program.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
