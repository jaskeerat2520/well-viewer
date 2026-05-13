'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { CountyImpactRow } from '@/lib/types';
import { RADIUS_1KM, RADIUS_5KM } from '@/lib/units';
import SiteHeader from '@/components/SiteHeader';

interface AboutTotals {
  unplugged_wells: number;
  total_pop_5km: number;
  wells_in_protection_zone: number;
  annual_co2e_mt: number;
  orphan_wells: number;
  last_computed: string | null;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return 'Unknown';
  const then = new Date(iso);
  const now  = new Date();
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 1)  return 'Today';
  if (days < 2)  return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toISOString().slice(0, 10);
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
      const [impactRes, emissionsRes, orphansRes, computedRes] = await Promise.all([
        supabase.from('county_impact_summary').select('*'),
        supabase.from('county_emissions_summary').select('annual_co2e_mt'),
        // head + exact count = row-free; only the Content-Range header round-trips
        supabase.from('well_map_view')
          .select('*', { count: 'exact', head: true })
          .neq('operator_status', 'named_operator'),
        supabase.from('well_risk_scores')
          .select('computed_at')
          .order('computed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (impactRes.data) {
        const counties = impactRes.data as CountyImpactRow[];
        const co2e = emissionsRes.data
          ? emissionsRes.data.reduce((s, r) => s + Number(r.annual_co2e_mt ?? 0), 0)
          : 0;
        setTotals({
          unplugged_wells: counties.reduce((s, r) => s + (r.unplugged_wells ?? 0), 0),
          total_pop_5km: counties.reduce((s, r) => s + (r.total_pop_5km ?? 0), 0),
          wells_in_protection_zone: counties.reduce((s, r) => s + (r.wells_in_protection_zone ?? 0), 0),
          annual_co2e_mt: Math.round(co2e),
          orphan_wells: orphansRes.count ?? 0,
          last_computed: computedRes.data?.computed_at ?? null,
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <SiteHeader title="About" sticky />

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-gray-900 to-gray-950 px-6 py-20 text-center border-b border-gray-800">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl font-bold mb-4 leading-tight">
            Ohio Has <span style={{ color: '#ef4444' }}>
              {totals ? totals.unplugged_wells.toLocaleString() : '…'}
            </span> Unplugged Oil & Gas Wells
          </h1>
          <p className="text-lg text-gray-300 mb-8 leading-relaxed">
            These abandoned wells leak methane, threaten drinking water, and endanger communities — and most Ohioans don&apos;t know they exist.
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
              <h3 className="text-lg font-bold mb-3">For Ohio&apos;s Economy</h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                Federal IIJA funding ($4.7B nationally) is available RIGHT NOW to fund well plugging. Ohio&apos;s backlog is estimated at $1–2B, creating local jobs and eliminating landowner liability.
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
            This tool fuses Ohio well records with satellite remote-sensing and airborne methane surveys to identify and prioritize unplugged wells by environmental risk.
          </p>
          <p>
            Each unplugged well is scored on <strong>five dimensions</strong>, weighted and merged into a composite risk score (0–100). Missing dimensions are renormalized out so partial-data wells aren&apos;t penalized.
          </p>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium uppercase tracking-wider">Dimension</th>
                  <th className="px-3 py-2 text-center font-medium uppercase tracking-wider">Weight</th>
                  <th className="px-4 py-2 text-left font-medium uppercase tracking-wider">What it measures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-4 py-2 font-semibold">Water risk</td>
                  <td className="px-3 py-2 text-center">30%</td>
                  <td className="px-4 py-2">Distance to nearest drinking-water source + whether well is inside a protection zone</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-semibold">Population exposure</td>
                  <td className="px-3 py-2 text-center">20%</td>
                  <td className="px-4 py-2">People living within {RADIUS_1KM} and {RADIUS_5KM} (Census 2020 tracts)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-semibold">Emissions</td>
                  <td className="px-3 py-2 text-center">20%</td>
                  <td className="px-4 py-2">Tiered CH₄ signal (plumes → L3 grid → S5P hotspot) + Landsat 9 thermal anomaly</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-semibold">Vegetation</td>
                  <td className="px-3 py-2 text-center">20%</td>
                  <td className="px-4 py-2">Multi-year NDVI trend + NDMI moisture stress (Sentinel-2, 2017–2024)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-semibold">Terrain</td>
                  <td className="px-3 py-2 text-center">10%</td>
                  <td className="px-4 py-2">Slope-ratio analysis on USGS 3DEP ~33 ft DEM — detects artificially graded pads</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Priority tiers are calibrated to the realized composite distribution: <strong>critical</strong> (≥45, top 0.06%), <strong>high</strong> (≥35, top 1.3%), <strong>medium</strong> (≥25, top 17.6%), <strong>low</strong> (&lt;25). Wells with an active named operator are capped at medium priority — they&apos;re the operator&apos;s legal responsibility, not plugging candidates.
          </p>
          <p className="text-xs text-gray-400">
            For per-dimension formulas, data source details, and known caveats, see the{' '}
            <Link href="/methodology" className="text-blue-400 hover:text-blue-300 underline">full methodology</Link>.
          </p>
        </div>
      </section>

      {/* What's on the map */}
      <section className="bg-gray-900 px-6 py-16 border-y border-gray-800">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-8">What&apos;s on the Map</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-gray-300 leading-relaxed">
            <div>
              <h3 className="text-sm font-semibold text-white mb-2">Layers</h3>
              <ul className="list-disc list-inside space-y-1.5 text-xs">
                <li>Priority-colored well dots (131K scored wells)</li>
                <li>County choropleth (risk or emissions)</li>
                <li>Drinking-water protection zones</li>
                <li>CH₄ plume detections (CarbonMapper + MethaneAIR, 276 points sized by flux)</li>
                <li>Satellite basemap (Bing, Esri, Mapbox, or Ohio OSIP 1 ft)</li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white mb-2">Filters</h3>
              <ul className="list-disc list-inside space-y-1.5 text-xs">
                <li>Priority tier (critical / high / medium / low)</li>
                <li>Color mode: recolor by emissions, vegetation, or terrain score</li>
                <li>RS flags: CH₄ anomaly, near plume, vegetation loss, artificially flat, clustered</li>
                <li>Orphans only (≈50K wells without an active named operator)</li>
                <li>Land cover (11 ESA WorldCover classes)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Data Sources */}
      <section className="bg-gray-950 px-6 py-12 border-y border-gray-800">
        <div className="max-w-5xl mx-auto">
          <h3 className="text-xs text-gray-400 uppercase tracking-wider mb-8 text-center">Data Sources</h3>

          <h4 className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Ground records &amp; policy</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-400 mb-8">
            <div>
              <p className="font-medium text-white mb-1">Ohio RBDMS (ODNR)</p>
              <p>Risk-Based Data Management System — 242,005 well records</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">Ohio EPA SWAP</p>
              <p>Source Water Assessment Program — 8,307 protection zones</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">US Census 2020</p>
              <p>Census Bureau tract geometry — 3,168 Ohio tracts</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">EPA GHGI 430-R-21-006</p>
              <p>Greenhouse Gas Inventory emission factors (CO₂e conversion)</p>
            </div>
          </div>

          <h4 className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Satellite remote-sensing (via Google Earth Engine)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-400 mb-8">
            <div>
              <p className="font-medium text-white mb-1">Sentinel-5P Tropomi</p>
              <p>Atmospheric CH₄ column concentration (2021–2024 mean)</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">Landsat 9</p>
              <p>Surface temperature — thermal anomaly detection (summer 2022–2024)</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">Sentinel-2 MSI</p>
              <p>~33 ft vegetation indices — NDVI / NDMI trends (2017–2024)</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">USGS 3DEP</p>
              <p>~33 ft digital elevation model — slope-ratio terrain analysis</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">ESA WorldCover 2021</p>
              <p>~33 ft global land-cover classification — cropland &amp; built-up masking</p>
            </div>
          </div>

          <h4 className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Airborne methane surveys</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-400">
            <div>
              <p className="font-medium text-white mb-1">CarbonMapper</p>
              <p>AVIRIS + Tanager plume detections (Ohio bbox, 2021–2026)</p>
            </div>
            <div>
              <p className="font-medium text-white mb-1">MethaneAIR</p>
              <p>Aircraft L3 grid + L4 super-emitter catalog (Appalachian basin)</p>
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
            <Link href="/methodology" className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium text-sm transition-colors">
              Methodology
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 px-6 py-6 border-t border-gray-800 text-center text-xs text-gray-500 space-y-1">
        <p>Data updated regularly from ODNR, Ohio EPA, US Census, and Google Earth Engine. Questions? Contact your county environmental agency.</p>
        {totals?.last_computed && (
          <p>
            Last scoring run: <span className="text-gray-300">{formatRelativeDate(totals.last_computed)}</span>
          </p>
        )}
      </footer>
    </div>
  );
}
