'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { CountyImpactRow } from '@/lib/types';
import { RADIUS_1KM, RADIUS_5KM } from '@/lib/units';
import SiteHeader from '@/components/SiteHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImpactTotals {
  unplugged_wells: number;
  total_pop_1km: number;
  total_pop_5km: number;
  wells_in_protection_zone: number;
  high_water_risk_count: number;
  counties_affected: number;
}

type SortKey = keyof Omit<CountyImpactRow, 'county'>;

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

export default function ImpactPage() {
  const [counties, setCounties] = useState<CountyImpactRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('total_pop_5km');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await supabase.from('county_impact_summary').select('*');
      if (res.data) {
        setCounties(res.data as CountyImpactRow[]);
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

  const sortedCounties = useMemo(() => {
    return [...counties].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [counties, sortKey, sortDir]);

  const totals: ImpactTotals = useMemo(() => {
    const affected = counties.filter(c => c.unplugged_wells > 0).length;
    return {
      unplugged_wells: counties.reduce((s, r) => s + (r.unplugged_wells ?? 0), 0),
      total_pop_1km: counties.reduce((s, r) => s + (r.total_pop_1km ?? 0), 0),
      total_pop_5km: counties.reduce((s, r) => s + (r.total_pop_5km ?? 0), 0),
      wells_in_protection_zone: counties.reduce((s, r) => s + (r.wells_in_protection_zone ?? 0), 0),
      high_water_risk_count: counties.reduce((s, r) => s + (r.high_water_risk_count ?? 0), 0),
      counties_affected: affected,
    };
  }, [counties]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <SiteHeader title="Environmental Impact" sticky />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-10">

        {loading && (
          <p className="text-gray-500 text-sm">Loading…</p>
        )}

        {/* ── Section 1: Exposure overview ──────────────────────────────────── */}
        {!loading && (
          <section>
            <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-4">Population & water exposure from unplugged wells</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatCard label="Unplugged wells" value={totals.unplugged_wells} color="#ef4444" />
              <StatCard label={`People within ${RADIUS_1KM}`} value={totals.total_pop_1km} color="#f97316" />
              <StatCard label={`People within ${RADIUS_5KM}`} value={totals.total_pop_5km} color="#eab308" />
              <StatCard label="In drinking water zones" value={totals.wells_in_protection_zone} color="#3b82f6" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="High water risk wells" value={totals.high_water_risk_count} color="#0891b2" />
              <StatCard label="Counties affected" value={totals.counties_affected} color="#a78bfa" />
            </div>
          </section>
        )}

        {/* ── Section 2: County breakdown ──────────────────────────────────── */}
        {counties.length > 0 && (
          <section>
            <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-4">
              County breakdown — click a column header to sort
            </h2>
            <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">County</th>
                    <SortHeader label="Unplugged" sortKey="unplugged_wells" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label={`Pop. ${RADIUS_1KM}`} sortKey="total_pop_1km" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label={`Pop. ${RADIUS_5KM}`} sortKey="total_pop_5km" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="In zone" sortKey="wells_in_protection_zone" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="% in zone" sortKey="pct_in_protection_zone" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="High H₂O risk" sortKey="high_water_risk_count" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Avg H₂O score" sortKey="avg_water_risk_score" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Avg pop score" sortKey="avg_pop_risk_score" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {sortedCounties.map(row => (
                    <tr key={row.county} className="hover:bg-gray-800/50">
                      <td className="px-3 py-2 font-medium capitalize">
                        <Link
                          href={`/counties/${encodeURIComponent(row.county)}`}
                          className="hover:text-white hover:underline underline-offset-2"
                        >
                          {row.county.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.unplugged_wells > 500 ? '#ef4444' : '#fff' }}>
                        {row.unplugged_wells.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.total_pop_1km > 0 ? '#f97316' : '#4b5563' }}>
                        {row.total_pop_1km.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.total_pop_5km > 0 ? '#eab308' : '#4b5563' }}>
                        {row.total_pop_5km.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.wells_in_protection_zone > 0 ? '#3b82f6' : '#4b5563' }}>
                        {row.wells_in_protection_zone.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">
                        {row.pct_in_protection_zone.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.high_water_risk_count > 0 ? '#0891b2' : '#4b5563' }}>
                        {row.high_water_risk_count.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">
                        {row.avg_water_risk_score ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">
                        {row.avg_pop_risk_score ?? '—'}
                      </td>
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
