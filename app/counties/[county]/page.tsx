'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import CountyMap from '@/components/CountyMap';
import SiteHeader from '@/components/SiteHeader';
import { formatDistanceUS, metersToFeet, RADIUS_1KM, RADIUS_5KM, RADIUS_500M } from '@/lib/units';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CountySummary {
  county: string;
  total_wells: number;
  plugged_wells: number;
  plug_candidates: number;
  active_producers: number;
  aging_producers: number;
  zombie_producers: number;
  paperwork_producers: number;
  orphan_program_wells: number;
  historic_owner_wells: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  scored_wells: number;
  operators_count: number;
  avg_composite: number | null;
  max_composite: number | null;
  wells_in_water_zone: number;
  avg_dist_to_water_m: number | null;
  wells_under_500m_water: number;
  depth_u500: number;
  depth_500_2k: number;
  depth_2k_5k: number;
  depth_5k_plus: number;
  depth_unknown: number;
}

interface DimensionBreakdown {
  county: string;
  water_n: number; population_n: number; vegetation_n: number; terrain_n: number; emissions_n: number; inactivity_n: number;
  avg_water: number | null;
  avg_population: number | null;
  avg_vegetation: number | null;
  avg_terrain: number | null;
  avg_emissions: number | null;
  avg_inactivity: number | null;
}

interface OperatorRow {
  operator: string;
  wells: number;
  plug_candidates: number;
  hidden_orphans: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  avg_composite: number | null;
}

interface TopWell {
  api_no: string;
  well_name: string | null;
  operator: string | null;
  status: string | null;
  priority: string | null;
  composite_risk_score: number | null;
  total_depth: number | null;
  lat: number | null;
  lng: number | null;
}

interface RemoteSensing {
  county: string;
  rs_rows: number;
  flat_pads: number;
  ch4_anomalies: number;
  thermal_2c: number;
  thermal_5c: number;
  emissions_hi: number;
  terrain_hi: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(s: string) {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function priorityColor(p: string | null): string {
  if (p === 'critical') return '#ef4444';
  if (p === 'high')     return '#f97316';
  if (p === 'medium')   return '#eab308';
  if (p === 'low')      return '#6b7280';
  return '#374151';
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)} B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)} K`;
  return `$${n.toLocaleString()}`;
}

// Plugging cost bands — match the /counties page logic but widen into low/mid/high.
const COST_BANDS = {
  u500:    { low: 15_000, mid: 20_000,  high: 30_000 },
  d500_2k: { low: 35_000, mid: 50_000,  high: 75_000 },
  d2k_5k:  { low: 80_000, mid: 110_000, high: 140_000 },
  d5k_plus:{ low: 150_000, mid: 200_000, high: 250_000 },
  unknown: { low: 15_000, mid: 20_000,  high: 30_000 }, // treat unknown as shallow
};

function costEstimate(s: CountySummary): { low: number; mid: number; high: number } {
  return {
    low:  s.depth_u500 * COST_BANDS.u500.low + s.depth_500_2k * COST_BANDS.d500_2k.low + s.depth_2k_5k * COST_BANDS.d2k_5k.low + s.depth_5k_plus * COST_BANDS.d5k_plus.low + s.depth_unknown * COST_BANDS.unknown.low,
    mid:  s.depth_u500 * COST_BANDS.u500.mid + s.depth_500_2k * COST_BANDS.d500_2k.mid + s.depth_2k_5k * COST_BANDS.d2k_5k.mid + s.depth_5k_plus * COST_BANDS.d5k_plus.mid + s.depth_unknown * COST_BANDS.unknown.mid,
    high: s.depth_u500 * COST_BANDS.u500.high + s.depth_500_2k * COST_BANDS.d500_2k.high + s.depth_2k_5k * COST_BANDS.d2k_5k.high + s.depth_5k_plus * COST_BANDS.d5k_plus.high + s.depth_unknown * COST_BANDS.unknown.high,
  };
}

// Dimension config (mirror of operator detail page, adapted for county keys)
// Weights mirror compute_composite.py — 2026-05-01: water 25 / pop 15 / veg 15 / terr 5 / emis 20 / inact 20.
type DimKey = 'avg_water' | 'avg_population' | 'avg_vegetation' | 'avg_terrain' | 'avg_emissions' | 'avg_inactivity';
const DIMENSIONS: { key: DimKey; label: string; weight: number; color: string; blurb: string }[] = [
  { key: 'avg_water',      label: 'Water',      weight: 25, color: '#60a5fa', blurb: 'proximity to drinking-water protection zones' },
  { key: 'avg_population', label: 'Population', weight: 15, color: '#c084fc', blurb: `people within ${RADIUS_1KM} / ${RADIUS_5KM}` },
  { key: 'avg_vegetation', label: 'Vegetation', weight: 15, color: '#4ade80', blurb: 'NDVI anomaly + multi-year trend (Sentinel-2)' },
  { key: 'avg_terrain',    label: 'Terrain',    weight:  5, color: '#fbbf24', blurb: 'artificial-pad detection (3DEP slope ratio)' },
  { key: 'avg_emissions',  label: 'Emissions',  weight: 20, color: '#f87171', blurb: 'CH4 (Sentinel-5P) + thermal (Landsat 9)' },
  { key: 'avg_inactivity', label: 'Inactivity', weight: 20, color: '#94a3b8', blurb: 'years since last reported production' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CountyDetailPage({
  params,
}: {
  params: Promise<{ county: string }>;
}) {
  const { county: rawCounty } = use(params);
  const county = safeDecode(rawCounty).toUpperCase();

  const [summary,    setSummary]    = useState<CountySummary | null>(null);
  const [dimensions, setDimensions] = useState<DimensionBreakdown | null>(null);
  const [operators,  setOperators]  = useState<OperatorRow[]>([]);
  const [topWells,   setTopWells]   = useState<TopWell[]>([]);
  const [remote,     setRemote]     = useState<RemoteSensing | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [notFound,   setNotFound]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotFound(false);

      const [sumRes, dimRes, opRes, wellsRes, rsRes] = await Promise.all([
        supabase.from('county_risk_summary').select('*').eq('county', county).maybeSingle(),
        supabase.from('county_dimension_breakdown').select('*').eq('county', county).maybeSingle(),
        supabase.from('operator_county_breakdown').select('*').eq('county', county).order('wells', { ascending: false }).limit(15),
        supabase.from('operator_well_details')
          .select('api_no, well_name, operator, status, priority, composite_risk_score, total_depth, lat, lng')
          .eq('county', county)
          .not('composite_risk_score', 'is', null)
          .order('composite_risk_score', { ascending: false })
          .limit(20),
        supabase.from('county_remote_signals_summary').select('*').eq('county', county).maybeSingle(),
      ]);

      if (cancelled) return;

      if (!sumRes.data) { setNotFound(true); setLoading(false); return; }

      setSummary(sumRes.data as unknown as CountySummary);
      setDimensions(dimRes.data as unknown as DimensionBreakdown | null);
      setOperators((opRes.data ?? []) as unknown as OperatorRow[]);
      setTopWells((wellsRes.data ?? []) as unknown as TopWell[]);
      setRemote(rsRes.data as unknown as RemoteSensing | null);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [county]);

  const pctPlug = summary && summary.total_wells > 0
    ? Math.round((summary.plug_candidates / summary.total_wells) * 1000) / 10
    : 0;
  const hiddenOrphans = summary ? summary.zombie_producers + summary.paperwork_producers : 0;
  const costs = summary ? costEstimate(summary) : null;

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white print:bg-white print:text-black">
      <SiteHeader title="County Brief" subtitle={summary ? `${titleCase(county)} · ${summary.total_wells.toLocaleString()} wells` : titleCase(county)} />

      {/* ── Title + Print button ─────────────────────────────────────── */}
      <div className="px-6 py-6 border-b border-gray-800 print:border-gray-300 print:py-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <Link href="/counties" className="text-xs text-gray-500 hover:text-white transition-colors mb-2 inline-block print:hidden">
              ← All counties
            </Link>
            <h2 className="text-2xl font-semibold tracking-tight print:text-3xl print:font-bold print:mb-1">
              {titleCase(county)} County — Well-Plugging Brief
            </h2>
            <p className="mt-1 text-xs text-gray-400 print:text-gray-700 print:text-[9.5pt]">
              Source: Ohio RBDMS · Ohio EPA SWAP protection zones · US Census 2020 · Google Earth Engine (Sentinel-2, Sentinel-5P, Landsat 9, USGS 3DEP)
            </p>
            <p className="mt-1 text-xs text-gray-400 print:text-gray-700 print:text-[9.5pt]">
              Generated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            <p className="hidden print:block mt-1 text-[9pt] text-gray-600">
              View live data online — search &quot;OH Well Risk&quot; for {titleCase(county)} County
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded text-xs font-medium border border-gray-600 text-gray-200 hover:bg-gray-800 transition-colors print:hidden"
          >
            🖨  Print / Save as PDF
          </button>
        </div>
      </div>

      {loading && <div className="px-6 py-10 text-gray-500 text-sm">Loading…</div>}

      {!loading && notFound && (
        <div className="px-6 py-10 text-gray-500 text-sm">
          County <span className="text-white font-mono">{county}</span> not found.
          <Link href="/counties" className="ml-3 text-blue-400 hover:underline">Back to list</Link>
        </div>
      )}

      {!loading && summary && (
        <>
          {/* ── Headline stats strip ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-px bg-gray-700 border-b border-gray-700 print:grid-cols-4 print:border print:border-gray-300 print:gap-0">
            <StatCell label="Total Wells"      value={summary.total_wells}     color="text-gray-200" />
            <StatCell label="Plugged"          value={summary.plugged_wells}   color="text-green-400" />
            <StatCell label="Plug Candidates"  value={summary.plug_candidates} color="text-orange-400" />
            <StatCell label="% Plug" value={pctPlug} suffix="%" fractional
                      color={pctPlug >= 60 ? 'text-red-400' : pctPlug >= 30 ? 'text-orange-400' : 'text-yellow-400'} />
            <StatCell label="Historic Owner"   value={summary.historic_owner_wells} color="text-orange-300" />
            <StatCell label="Critical + High"  value={summary.critical + summary.high} color="text-red-400" />
            <StatCell label="Operators"        value={summary.operators_count} color="text-gray-300" />
            <StatCell label="Avg Composite"    value={summary.avg_composite ?? 0} fractional color="text-yellow-400" />
          </div>

          {/* ── Map of all scored wells in the county ─────────────────── */}
          <section id="wells-map" className="px-6 pt-6 print:hidden scroll-mt-16">
            <div className="bg-gray-900 rounded border border-gray-800 overflow-hidden">
              <header className="px-4 py-3 border-b border-gray-800">
                <h3 className="text-sm font-semibold">Wells Map</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Every scored well in {titleCase(county)} colored by priority. Click a point for operator + composite score.
                </p>
              </header>
              <CountyMap county={county} />
            </div>
          </section>

          <p className="hidden print:block mx-4 mt-3 px-3 py-2 border border-gray-300 text-[10pt] text-gray-700">
            An interactive map of all scored {titleCase(county)} wells colored by priority is available online at the project URL above.
          </p>

          {/* ── Plugging cost estimate ───────────────────────────────── */}
          {costs && (
            <section className="px-6 pt-6 print:px-4 print:pt-4 print:break-inside-avoid">
              <div className="bg-gray-900 rounded border border-gray-800 print:border-gray-300 print:bg-white">
                <header className="px-4 py-3 border-b border-gray-800 print:border-gray-300 flex items-baseline justify-between flex-wrap gap-2 print:flex-col print:items-start print:gap-1">
                  <h3 className="text-sm font-semibold print:text-base">Estimated Plugging Cost</h3>
                  <div className="text-xs font-mono print:text-[10pt]">
                    <span className="text-gray-500 print:text-gray-700">Low </span><span className="text-green-400 font-semibold print:text-green-700">{money(costs.low)}</span>
                    <span className="text-gray-600 print:text-gray-500"> · </span>
                    <span className="text-gray-500 print:text-gray-700">Mid </span><span className="text-emerald-400 font-semibold text-base print:text-emerald-700">{money(costs.mid)}</span>
                    <span className="text-gray-600 print:text-gray-500"> · </span>
                    <span className="text-gray-500 print:text-gray-700">High </span><span className="text-orange-400 font-semibold print:text-orange-700">{money(costs.high)}</span>
                  </div>
                </header>
                <div className="p-4 print:p-2">
                  <table className="text-xs w-full print:text-[11px]">
                    <thead className="text-gray-400 print:text-gray-700">
                      <tr className="border-b border-gray-800 print:border-gray-300">
                        <th className="py-1 text-left font-medium uppercase tracking-wider text-[10px] print:text-[9pt]">Depth tier</th>
                        <th className="py-1 text-right font-medium uppercase tracking-wider text-[10px] print:text-[9pt]">Wells</th>
                        <th className="py-1 text-right font-medium uppercase tracking-wider text-[10px] print:text-[9pt]">$/well (mid)</th>
                        <th className="py-1 text-right font-medium uppercase tracking-wider text-[10px] print:text-[9pt]">Subtotal (mid)</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      <DepthRow label="< 500 ft"          wells={summary.depth_u500}     per={COST_BANDS.u500.mid} />
                      <DepthRow label="500 – 2,000 ft"    wells={summary.depth_500_2k}   per={COST_BANDS.d500_2k.mid} />
                      <DepthRow label="2,000 – 5,000 ft"  wells={summary.depth_2k_5k}    per={COST_BANDS.d2k_5k.mid} />
                      <DepthRow label="5,000+ ft"         wells={summary.depth_5k_plus}  per={COST_BANDS.d5k_plus.mid} />
                      <DepthRow label="Unknown (shallow)" wells={summary.depth_unknown}  per={COST_BANDS.unknown.mid} />
                      <tr className="border-t border-gray-700 print:border-gray-500">
                        <td className="py-2 font-semibold font-sans">Total</td>
                        <td className="py-2 text-right font-semibold">
                          {(summary.depth_u500 + summary.depth_500_2k + summary.depth_2k_5k + summary.depth_5k_plus + summary.depth_unknown).toLocaleString()}
                        </td>
                        <td></td>
                        <td className="py-2 text-right font-semibold text-emerald-400 print:text-emerald-700">
                          {money(costs.mid)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <footer className="px-4 py-2 border-t border-gray-800 print:border-gray-300 text-[10px] text-gray-500 print:text-[8.5pt] print:text-gray-700">
                  Cost bands by depth: &lt;500ft $15-30k · 500-2k $35-75k · 2-5k $80-140k · 5k+ $150-250k. Unknown depths conservatively treated as shallow.
                </footer>
              </div>
            </section>
          )}

          {/* ── Well classification ─────────────────────────────────── */}
          <section className="px-6 pt-6 print:px-4 print:pt-4 print:break-inside-avoid">
            <div className="bg-gray-900 rounded border border-gray-800 print:border-gray-300 print:bg-white">
              <header className="px-4 py-3 border-b border-gray-800 print:border-gray-300">
                <h3 className="text-sm font-semibold print:text-base">Well Classification</h3>
                <p className="text-[11px] text-gray-500 mt-0.5 print:text-gray-600">
                  How this county&apos;s {summary.total_wells.toLocaleString()} wells split across plugging-relevance buckets.
                </p>
              </header>
              <div className="p-3 print:p-2">
                <table className="text-xs w-full print:text-[11px]">
                  <tbody>
                    {(() => {
                      const classified = summary.plugged_wells + summary.active_producers + summary.aging_producers + summary.zombie_producers + summary.paperwork_producers;
                      const other = Math.max(summary.total_wells - classified, 0);
                      const buckets = [
                        {
                          label: 'Plugged',             hint: 'plug date recorded',                         count: summary.plugged_wells,       color: '#22c55e',
                          tooltip: 'Plugged: well has a plug date on record in ODNR. Already retired — surface and subsurface sealed. No further action needed.',
                        },
                        {
                          label: 'Producing (2020+)',      hint: 'Last production ≥ 2020',                  count: summary.active_producers,    color: '#9ca3af',
                          tooltip: "Status='Producing' in ODNR AND reported non-zero production in 2020 or later. A real operating well with recent revenue — not a plug candidate.",
                        },
                        {
                          label: 'Producing (2015–19)',    hint: 'Last production 2015–2019',               count: summary.aging_producers,     color: '#eab308',
                          tooltip: "Status='Producing' AND last reported production was 2015–2019. Recently productive but now quiet. May be winding down — worth monitoring for near-future plugging.",
                        },
                        {
                          label: 'Producing (<2015)',      hint: 'Last production before 2015',             count: summary.zombie_producers,    color: '#f97316',
                          tooltip: "Status='Producing' in ODNR, BUT last reported production was before 2015. Nominally active, yet has not produced oil or gas in 10+ years. The operator still exists on paper but the well is economically dead — hidden among 'active' wells.",
                        },
                        {
                          label: 'No production filed',    hint: 'No production year on record',            count: summary.paperwork_producers, color: '#f43f5e',
                          tooltip: "Status='Producing' in ODNR, BUT zero production has ever been reported. The well was registered as producing, but no quarterly output has ever been filed. Exists only on paper.",
                        },
                        {
                          label: 'Other',               hint: 'permit-only, injection, storage, FI WNF, …', count: other,                       color: '#6b7280',
                          tooltip: 'Other: wells with statuses outside the main production lifecycle — Permit Expired, Well Drilled, Active Injection, Storage Well, Field Inspected / Well Not Found, Unknown status, Drilling, and similar. Each has its own regulatory path; most are not plug candidates for a training-crew program.',
                        },
                      ];
                      return buckets.map((b, i) => {
                        const pct = summary.total_wells > 0 ? b.count / summary.total_wells : 0;
                        return (
                          <tr
                            key={b.label}
                            title={b.tooltip}
                            className={`${i % 2 === 1 ? 'bg-gray-900/40 print:bg-transparent' : ''} hover:bg-gray-800/60 transition-colors cursor-help`}
                          >
                            <td className="px-2 py-1.5">
                              <div className="font-medium print:text-[10pt]" style={{ color: b.color }}>{b.label}</div>
                              <div className="text-[10px] text-gray-500 print:text-gray-700 print:text-[9pt]">{b.hint}</div>
                            </td>
                            <td className="px-2 py-1.5 font-mono text-right w-20 print:text-[10pt]">{b.count.toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right w-56">
                              <div className="inline-block w-36 h-2 bg-gray-800 rounded overflow-hidden align-middle print:border print:border-gray-400 print:bg-white">
                                <div className="h-full" style={{ width: `${Math.max(pct * 100, b.count > 0 ? 1 : 0)}%`, background: b.color, opacity: 0.9 }} />
                              </div>
                              <span className="text-[10px] text-gray-500 print:text-gray-700 print:text-[9pt] ml-2 font-mono">{(pct * 100).toFixed(1)}%</span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Risk dimension breakdown ──────────────────────────────── */}
          {dimensions && (
            <section className="px-6 pt-6 print:px-4 print:pt-4 print:break-inside-avoid">
              <div className="bg-gray-900 rounded border border-gray-800 print:border-gray-300 print:bg-white">
                <header className="px-4 py-3 border-b border-gray-800 print:border-gray-300 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-semibold print:text-base">Risk Dimension Breakdown</h3>
                    <p className="text-[11px] text-gray-500 mt-0.5 print:text-gray-600">
                      Average score (0–100) across {(dimensions.water_n ?? 0).toLocaleString()} scored wells · higher = more risk
                    </p>
                  </div>
                </header>
                <div className="p-4 space-y-2 print:p-3">
                  {DIMENSIONS.map(dim => {
                    const val = (dimensions[dim.key] as number | null) ?? 0;
                    const width = Math.min(Math.max(val, 0), 100);
                    return (
                      <div key={dim.key} className="flex items-center gap-3 text-xs print:text-[10pt]">
                        <div className="w-40 shrink-0">
                          <div className="font-medium" style={{ color: dim.color }}>{dim.label}</div>
                          <div className="text-[10px] text-gray-500 print:text-gray-700 print:text-[9pt]">{dim.weight}% weight · {dim.blurb}</div>
                        </div>
                        <div className="flex-1 h-5 bg-gray-800 rounded overflow-hidden relative print:bg-white print:border print:border-gray-400">
                          <div className="h-full rounded" style={{ width: `${width}%`, background: dim.color, opacity: 0.85 }} />
                          {[25, 50, 75].map(t => (
                            <div key={t} className="absolute top-0 bottom-0 border-l border-gray-700 print:border-gray-400" style={{ left: `${t}%` }} />
                          ))}
                        </div>
                        <div className="w-16 text-right font-mono font-semibold" style={{ color: dim.color }}>
                          {val.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ── Water / population exposure ────────────────────────────── */}
          <section className="px-6 pt-6 print:px-4 print:pt-4 print:break-inside-avoid">
            <div className="bg-gray-900 rounded border border-gray-800 print:border-gray-300 print:bg-white">
              <header className="px-4 py-3 border-b border-gray-800 print:border-gray-300">
                <h3 className="text-sm font-semibold print:text-base">Water & Population Exposure</h3>
              </header>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-700 print:bg-white print:gap-0 print:border print:border-gray-300">
                <StatCell label="Wells in Protection Zone" value={summary.wells_in_water_zone}    color="text-blue-400" />
                <StatCell label={`Wells within ${RADIUS_500M} of water`} value={summary.wells_under_500m_water} color="text-blue-300" />
                <StatCell label="Avg distance to water" value={formatDistanceUS(summary.avg_dist_to_water_m)}
                          color="text-gray-300" />
                <StatCell label="Orphan Program Enrolled" value={summary.orphan_program_wells}    color="text-red-300" />
              </div>
            </div>
          </section>

          {/* ── Remote-sensing anomalies ──────────────────────────────── */}
          {remote && remote.rs_rows > 0 && (
            <section className="px-6 pt-6 print:px-4 print:pt-4 print:break-inside-avoid">
              <div className="bg-gray-900 rounded border border-gray-800 print:border-gray-300 print:bg-white">
                <header className="px-4 py-3 border-b border-gray-800 print:border-gray-300">
                  <h3 className="text-sm font-semibold print:text-base">Satellite Remote-Sensing Footprint</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5 print:text-gray-600">
                    Analyzed across {remote.rs_rows.toLocaleString()} wells in this county.
                  </p>
                </header>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-gray-700 print:bg-white print:grid-cols-3 print:gap-0 print:border print:border-gray-300">
                  <StatCell label="Artificially flat pads"    value={remote.flat_pads}     color="text-amber-400" />
                  <StatCell label="CH4 anomalies"             value={remote.ch4_anomalies} color="text-red-400" />
                  <StatCell label="Thermal ≥ 2°C"             value={remote.thermal_2c}    color="text-orange-400" />
                  <StatCell label="Thermal ≥ 5°C (strong)"    value={remote.thermal_5c}    color="text-red-500" />
                  <StatCell label="Emissions score ≥ 50"      value={remote.emissions_hi}  color="text-rose-400" />
                  <StatCell label="Terrain score ≥ 50"        value={remote.terrain_hi}    color="text-yellow-400" />
                </div>
              </div>
            </section>
          )}

          {/* ── Operator breakdown ───────────────────────────────────── */}
          <section className="px-6 pt-6 print:px-4 print:pt-4 print:break-inside-avoid">
            <div className="bg-gray-900 rounded border border-gray-800 print:border-gray-300 print:bg-white">
              <header className="px-4 py-3 border-b border-gray-800 print:border-gray-300 flex items-center justify-between">
                <h3 className="text-sm font-semibold print:text-base">Operator Landscape (top {operators.length})</h3>
                <span className="text-[10px] text-gray-500 print:text-gray-700 uppercase tracking-wider">Sorted by well count</span>
              </header>
              <div className="overflow-auto print:overflow-visible">
                <table className="text-xs w-full print:text-[11px]">
                  <thead className="bg-gray-800 text-gray-400 print:bg-gray-100 print:text-gray-700">
                    <tr>
                      <Th align="left">Operator</Th>
                      <Th>Wells</Th>
                      <Th>Plug Cand</Th>
                      <Th>Hidden</Th>
                      <Th>Crit</Th>
                      <Th>High</Th>
                      <Th>Med</Th>
                      <Th>Low</Th>
                      <Th>Avg Score</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {operators.map((o, i) => {
                      const isHistoric = o.operator === 'HISTORIC OWNER';
                      return (
                        <tr key={o.operator} className={i % 2 === 1 ? 'bg-gray-900/40 print:bg-transparent' : ''}>
                          <td className="px-3 py-1 font-medium whitespace-nowrap max-w-xs truncate print:max-w-none print:whitespace-normal" title={o.operator}>
                            {isHistoric && <span className="mr-2 text-[9px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/40 print:bg-orange-100 print:text-orange-800 print:border-orange-300">HISTORIC</span>}
                            <Link
                              href={`/operators/${encodeURIComponent(o.operator)}`}
                              className={`${isHistoric ? 'text-orange-300 print:text-orange-800' : 'text-gray-200 print:text-black'} hover:underline`}
                            >
                              {o.operator}
                            </Link>
                          </td>
                          <td className="px-2 py-1 font-mono text-right">{o.wells.toLocaleString()}</td>
                          <td className="px-2 py-1 font-mono text-right text-orange-400 print:text-orange-700">{o.plug_candidates || '—'}</td>
                          <td className="px-2 py-1 font-mono text-right text-rose-400 print:text-rose-700">{o.hidden_orphans || '—'}</td>
                          <td className="px-2 py-1 font-mono text-right text-red-400 print:text-red-700">{o.critical || '—'}</td>
                          <td className="px-2 py-1 font-mono text-right text-orange-400 print:text-orange-700">{o.high || '—'}</td>
                          <td className="px-2 py-1 font-mono text-right text-yellow-400 print:text-yellow-700">{o.medium || '—'}</td>
                          <td className="px-2 py-1 font-mono text-right text-gray-400 print:text-gray-600">{o.low || '—'}</td>
                          <td className="px-2 py-1 font-mono text-right text-gray-300 print:text-gray-700">{o.avg_composite?.toFixed(1) ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Top 20 wells by risk ────────────────────────────────── */}
          <section className="px-6 pt-6 pb-8 print:px-4 print:pt-4 print:break-inside-avoid">
            <div className="bg-gray-900 rounded border border-gray-800 print:border-gray-300 print:bg-white">
              <header className="px-4 py-3 border-b border-gray-800 print:border-gray-300 flex items-center justify-between">
                <h3 className="text-sm font-semibold print:text-base">Top {topWells.length} Highest-Risk Wells</h3>
                <span className="text-[10px] text-gray-500 print:text-gray-700 uppercase tracking-wider">Sorted by composite score</span>
              </header>
              <div className="overflow-auto print:overflow-visible">
                <table className="text-xs w-full print:text-[10px]">
                  <thead className="bg-gray-800 text-gray-400 print:bg-gray-100 print:text-gray-700">
                    <tr>
                      <Th align="left">Score</Th>
                      <Th align="left">Pri</Th>
                      <Th align="left">Well</Th>
                      <Th align="left">Operator</Th>
                      <Th align="left">Status</Th>
                      <Th>Depth</Th>
                      <Th align="left">Lat, Lng</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {topWells.map((w, i) => (
                      <tr key={w.api_no} className={i % 2 === 1 ? 'bg-gray-900/40 print:bg-transparent' : ''}>
                        <td className="px-2 py-1 font-mono font-semibold" style={{ color: priorityColor(w.priority) }}>
                          {w.composite_risk_score != null ? w.composite_risk_score.toFixed(0) : '—'}
                        </td>
                        <td className="px-2 py-1">
                          {w.priority ? (
                            <span className="px-1.5 py-0.5 text-[10px] rounded uppercase tracking-wide font-semibold"
                                  style={{ background: priorityColor(w.priority), color: '#000' }}>
                              {w.priority}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-2 py-1">
                          <Link href={`/wells/${encodeURIComponent(w.api_no)}`} className="hover:underline">
                            <div className="text-gray-200 print:text-black">{w.well_name ?? '(unnamed)'}</div>
                            <div className="text-[9px] text-gray-600 print:text-gray-600 print:text-[8.5pt] font-mono">{w.api_no}</div>
                          </Link>
                        </td>
                        <td className="px-2 py-1 max-w-[14rem] truncate" title={w.operator ?? ''}>
                          {w.operator ? (
                            <Link href={`/operators/${encodeURIComponent(w.operator)}`} className="text-gray-300 print:text-black hover:underline">
                              {w.operator}
                            </Link>
                          ) : '—'}
                        </td>
                        <td className="px-2 py-1 text-gray-400 print:text-gray-600">{w.status ?? '—'}</td>
                        <td className="px-2 py-1 font-mono text-right text-gray-400 print:text-gray-600">{w.total_depth ?? '—'}</td>
                        <td className="px-2 py-1 font-mono text-gray-500 print:text-gray-600">
                          {w.lat != null && w.lng != null ? `${w.lat.toFixed(3)}, ${w.lng.toFixed(3)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Print footer ──────────────────────────────────────────── */}
          <div className="hidden print:block px-4 py-3 text-[9pt] text-gray-700 border-t border-gray-300">
            Ohio Well-Plugging Prioritization Project · Data prepared for grant submission · Contact the project team for full underlying well list (CSV).
            {typeof window !== 'undefined' && (
              <span className="block mt-0.5 font-mono text-[8.5pt] text-gray-600">
                {window.location.origin}/counties/{county}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────────────────

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-2 py-2 font-medium uppercase tracking-wider whitespace-nowrap border-b border-gray-700 print:border-gray-300 ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ fontSize: '10px' }}
    >
      {children}
    </th>
  );
}

function StatCell({
  label, value, color, suffix, fractional,
}: {
  label: string;
  value: number | string;
  color: string;
  suffix?: string;
  fractional?: boolean;
}) {
  const body = typeof value === 'string'
    ? value
    : (fractional ? value.toFixed(1) : value.toLocaleString());
  return (
    <div className="bg-gray-900 px-4 py-3 print:bg-white print:py-3 print:border-r print:border-b print:border-gray-300">
      <div className="text-gray-500 uppercase tracking-wider print:text-gray-700 text-[10px] print:text-[9pt]">{label}</div>
      <div className={`font-mono font-semibold mt-1 text-lg ${color} print:text-black print:text-base`}>
        {body}{suffix || ''}
      </div>
    </div>
  );
}

function DepthRow({ label, wells, per }: { label: string; wells: number; per: number }) {
  return (
    <tr>
      <td className="py-1">{label}</td>
      <td className="py-1 text-right">{wells.toLocaleString()}</td>
      <td className="py-1 text-right">{money(per)}</td>
      <td className="py-1 text-right text-emerald-400 print:text-emerald-700">{money(wells * per)}</td>
    </tr>
  );
}
