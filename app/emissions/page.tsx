'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { CountyEmissionsRow } from '@/lib/types';
import SiteHeader from '@/components/SiteHeader';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmissionsTotals {
  unplugged_wells: number;
  total_co2e_mt: number;
  cars_equivalent: number;
  gas_wells: number;
  oil_wells: number;
  brine_wells: number;
  unknown_wells: number;
}

type SortKey = keyof Omit<CountyEmissionsRow, 'county'>;

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

export default function EmissionsPage() {
  const [counties, setCounties] = useState<CountyEmissionsRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('annual_co2e_mt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await supabase.from('county_emissions_summary').select('*');
      if (res.data) {
        setCounties(res.data as CountyEmissionsRow[]);
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

  const totals: EmissionsTotals = useMemo(() => {
    const total_co2e_mt = counties.reduce((s, r) => s + (r.annual_co2e_mt ?? 0), 0);
    return {
      unplugged_wells: counties.reduce((s, r) => s + (r.unplugged_wells ?? 0), 0),
      total_co2e_mt,
      cars_equivalent: Math.round(total_co2e_mt / 4.6),
      gas_wells: counties.reduce((s, r) => s + (r.gas_wells ?? 0), 0),
      oil_wells: counties.reduce((s, r) => s + (r.oil_wells ?? 0), 0),
      brine_wells: counties.reduce((s, r) => s + (r.brine_wells ?? 0), 0),
      unknown_wells: counties.reduce((s, r) => s + (r.unknown_wells ?? 0), 0),
    };
  }, [counties]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <SiteHeader title="Methane Emissions" sticky />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-10">

        {loading && (
          <p className="text-gray-500 text-sm">Loading…</p>
        )}

        {/* ── Section 1: Emissions overview ──────────────────────────────────── */}
        {!loading && (
          <section>
            <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-2">Estimated annual methane emissions from unplugged wells</h2>
            <p className="text-xs text-gray-500 mb-4">EPA 430-R-21-006 factors · gas=9.5 mt/yr · oil=2.5 mt/yr · brine=0.5 mt/yr · GWP-100=28</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatCard label="Unplugged wells" value={totals.unplugged_wells} color="#ef4444" />
              <StatCard label="Annual CO₂e (mt/yr)" value={totals.total_co2e_mt} color="#f97316" />
              <StatCard label="Cars off road equiv." value={totals.cars_equivalent} color="#eab308" />
              <StatCard label="Gas wells" value={totals.gas_wells} color="#3b82f6" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Oil wells" value={totals.oil_wells} color="#22c55e" />
              <StatCard label="Brine/disposal wells" value={totals.brine_wells} color="#0891b2" />
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
                    <SortHeader label="Total unplugged" sortKey="unplugged_wells" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="CO₂e mt/yr" sortKey="annual_co2e_mt" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Cars equiv." sortKey="cars_equivalent" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Gas wells" sortKey="gas_wells" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Oil wells" sortKey="oil_wells" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortHeader label="Brine wells" sortKey="brine_wells" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {sortedCounties.map(row => (
                    <tr key={row.county} className="hover:bg-gray-800/50">
                      <td className="px-3 py-2 font-medium capitalize">{row.county.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}</td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.unplugged_wells > 500 ? '#ef4444' : '#fff' }}>
                        {row.unplugged_wells.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.annual_co2e_mt > 5000 ? '#f97316' : '#fff' }}>
                        {row.annual_co2e_mt.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.cars_equivalent > 1000 ? '#eab308' : '#fff' }}>
                        {row.cars_equivalent.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.gas_wells > 0 ? '#3b82f6' : '#4b5563' }}>
                        {row.gas_wells.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.oil_wells > 0 ? '#22c55e' : '#4b5563' }}>
                        {row.oil_wells.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: row.brine_wells > 0 ? '#0891b2' : '#4b5563' }}>
                        {row.brine_wells.toLocaleString()}
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
