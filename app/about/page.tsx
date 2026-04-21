'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { CountyImpactRow } from '@/lib/types';

interface AboutTotals {
  unplugged_wells: number;
  total_pop_5km: number;
  wells_in_protection_zone: number;
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      <p className="text-3xl font-bold" style={{ color: color ?? '#fff' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

export default function AboutPage() {
  const [totals, setTotals] = useState<AboutTotals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await supabase.from('county_impact_summary').select('*');
      if (res.data) {
        const counties = res.data as CountyImpactRow[];
        setTotals({
          unplugged_wells: counties.reduce((s, r) => s + (r.unplugged_wells ?? 0), 0),
          total_pop_5km: counties.reduce((s, r) => s + (r.total_pop_5km ?? 0), 0),
          wells_in_protection_zone: counties.reduce((s, r) => s + (r.wells_in_protection_zone ?? 0), 0),
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-700 sticky top-0 z-10">
        <h1 className="text-sm font-semibold tracking-tight">Ohio Well Risk</h1>
        <nav className="flex items-center gap-4">
          <Link href="/table"     className="text-xs text-gray-400 hover:text-white transition-colors">Table</Link>
          <Link href="/counties"  className="text-xs text-gray-400 hover:text-white transition-colors">Counties</Link>
          <Link href="/facts"     className="text-xs text-gray-400 hover:text-white transition-colors">Facts</Link>
          <Link href="/impact"    className="text-xs text-gray-400 hover:text-white transition-colors">Impact</Link>
          <Link href="/emissions" className="text-xs text-gray-400 hover:text-white transition-colors">Emissions →</Link>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-gray-900 to-gray-950 px-6 py-20 text-center border-b border-gray-800">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl font-bold mb-4 leading-tight">
            Ohio Has <span style={{ color: '#ef4444' }}>
              {totals ? totals.unplugged_wells.toLocaleString() : '37,863'}
            </span> Unplugged Oil & Gas Wells
          </h1>
          <p className="text-lg text-gray-300 mb-8 leading-relaxed">
            These abandoned wells leak methane, threaten drinking water, and endanger communities — and most Ohioans don't know they exist.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/" className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium text-sm transition-colors">
              Explore the Map →
            </Link>
            <Link href="/counties" className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium text-sm transition-colors border border-gray-700">
              See County Data →
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      {!loading && totals && (
        <section className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-8 text-center">The Scale of the Crisis</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Unplugged Wells" value={totals.unplugged_wells} color="#ef4444" />
            <StatCard label="Annual CO₂e (metric tons)" value="142,078" color="#f97316" />
            <StatCard label="People within 5 km" value={totals.total_pop_5km} color="#eab308" />
            <StatCard label="In Drinking Water Zones" value={totals.wells_in_protection_zone} color="#3b82f6" />
          </div>
        </section>
      )}

      {/* Why It Matters Section */}
      <section className="bg-gray-900 px-6 py-16 border-t border-gray-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-12 text-center">Why It Matters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Health */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="text-3xl mb-3">💧</div>
              <h3 className="text-lg font-bold mb-3">For Your Health</h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                Unplugged wells leak benzene, methane, and brine into groundwater. {totals && totals.wells_in_protection_zone > 0 && `${totals.wells_in_protection_zone.toLocaleString()} wells`} are inside source water protection zones, putting public water supplies at risk across Ohio.
              </p>
            </div>

            {/* Climate */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="text-3xl mb-3">🌍</div>
              <h3 className="text-lg font-bold mb-3">For Our Climate</h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                Abandoned wells collectively emit ~142,000 metric tons of CO₂ equivalent per year — equal to removing 30,000 cars from the road. Every plugged well is a permanent climate win.
              </p>
            </div>

            {/* Economy */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="text-3xl mb-3">💼</div>
              <h3 className="text-lg font-bold mb-3">For Ohio's Economy</h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                Federal IIJA funding ($4.7B nationally) is available RIGHT NOW to fund well plugging. Ohio's backlog is estimated at $1–2B, creating local jobs and eliminating landowner liability.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* About the Tool */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-8">About This Tool</h2>
        <div className="space-y-6 text-gray-300 text-sm leading-relaxed">
          <p>
            This tool combines three authoritative data sources to identify and prioritize Ohio's unplugged wells by environmental risk:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><strong>Ohio RBDMS (ODNR)</strong> — 242,005 well records with location, type, status, and depth</li>
            <li><strong>Ohio EPA SWAP</strong> — 8,307 drinking water protection zone polygons</li>
            <li><strong>US Census 2020</strong> — 3,168 population tracts with tract-level demographics</li>
            <li><strong>EPA 430-R-21-006</strong> — Methane emission factors by well type (gas: 9.5 mt CO₂e/yr, oil: 2.5 mt CO₂e/yr)</li>
          </ul>
          <p>
            Each unplugged well is scored on three dimensions: <strong>water risk</strong> (distance to nearest source + whether inside protection zone), <strong>population exposure</strong> (people within 1km and 5km), and <strong>methane emissions</strong> (converted to annual CO₂ equivalent). These scores enable policymakers and ODNR to target plugging resources where they'll have the most impact.
          </p>
        </div>
      </section>

      {/* Data Sources */}
      <section className="bg-gray-900 px-6 py-12 border-y border-gray-800 my-8">
        <div className="max-w-4xl mx-auto">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-6 text-center">Data Sources</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-400">
            <div>
              <p className="font-medium text-white mb-1">Ohio RBDMS (ODNR)</p>
              <p>Ohio Department of Natural Resources — Division of Oil and Gas</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">EPA SWAP</p>
              <p>Ohio EPA Source Water Assessment Program — 8,307 protection zones</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">US Census 2020</p>
              <p>Census Bureau American Community Survey — 3,168 Ohio census tracts</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">EPA GHGI</p>
              <p>Greenhouse Gas Inventory — 430-R-21-006 emission factors</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <section className="bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-12 border-t border-gray-800">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-xl font-bold mb-4">Ready to Take Action?</h2>
          <p className="text-gray-300 mb-8">
            Explore the interactive map, find unplugged wells in your county, and share this tool with your representatives.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/" className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded font-medium text-sm transition-colors">
              Explore the Map
            </Link>
            <Link href="/counties" className="px-6 py-2 bg-orange-600 hover:bg-orange-700 rounded font-medium text-sm transition-colors">
              County Breakdown
            </Link>
            <Link href="/emissions" className="px-6 py-2 bg-yellow-600 hover:bg-yellow-700 rounded font-medium text-sm transition-colors">
              Emissions Data
            </Link>
            <Link href="/impact" className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium text-sm transition-colors">
              Environmental Impact
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 px-6 py-6 border-t border-gray-800 text-center text-xs text-gray-500">
        <p>Data updated regularly from ODNR, Ohio EPA, and US Census. Questions? Contact your county environmental agency.</p>
      </footer>
    </div>
  );
}
