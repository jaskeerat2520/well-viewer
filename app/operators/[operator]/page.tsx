'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getCached, setCached } from '@/lib/idbCache';
import { RADIUS_1KM, RADIUS_5KM } from '@/lib/units';
import SiteHeader from '@/components/SiteHeader';

const OPERATOR_DETAIL_VERSION = 2;
const TTL_24H = 24 * 60 * 60 * 1000;

interface OperatorDetailBundle {
  summary: OperatorSummary | null;
  contact: Contact | null;
  counties: CountyRow[];
  topWells: TopWell[];
  dimensions: DimensionBreakdown | null;
}

interface OperatorSummary {
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
}

interface Contact {
  operator_address: string | null;
  operator_phone: string | null;
}

interface CountyRow {
  county: string;
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
  county: string | null;
  status: string | null;
  priority: string | null;
  composite_risk_score: number | null;
  total_depth: number | null;
}

interface DimensionBreakdown {
  operator: string;
  water_n: number;
  population_n: number;
  vegetation_n: number;
  terrain_n: number;
  emissions_n: number;
  inactivity_n: number;
  avg_water: number | null;
  avg_population: number | null;
  avg_vegetation: number | null;
  avg_terrain: number | null;
  avg_emissions: number | null;
  avg_inactivity: number | null;
}

// Order + weight from CLAUDE.md (must match compute_composite.py).
// 2026-05-01: water 25 / pop 15 / veg 15 / terr 5 / emis 20 / inact 20.
const DIMENSIONS: { key: keyof DimensionBreakdown; label: string; weight: number; color: string; blurb: string }[] = [
  { key: 'avg_water',      label: 'Water',      weight: 25, color: '#60a5fa', blurb: 'proximity to drinking-water protection zones' },
  { key: 'avg_population', label: 'Population', weight: 15, color: '#c084fc', blurb: `people within ${RADIUS_1KM} / ${RADIUS_5KM}` },
  { key: 'avg_vegetation', label: 'Vegetation', weight: 15, color: '#4ade80', blurb: 'NDVI anomaly + multi-year trend (Sentinel-2)' },
  { key: 'avg_terrain',    label: 'Terrain',    weight:  5, color: '#fbbf24', blurb: 'artificial-pad detection (3DEP slope ratio)' },
  { key: 'avg_emissions',  label: 'Emissions',  weight: 20, color: '#f87171', blurb: 'CH4 anomaly (Sentinel-5P) + thermal (Landsat 9)' },
  { key: 'avg_inactivity', label: 'Inactivity', weight: 20, color: '#94a3b8', blurb: 'years since last reported production' },
];

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
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

export default function OperatorDetailPage({
  params,
}: {
  params: Promise<{ operator: string }>;
}) {
  // Next.js delivers the raw (URL-encoded) segment; decode so it matches DB values.
  const { operator: rawOperator } = use(params);
  const operator = safeDecode(rawOperator);

  const [summary,    setSummary]    = useState<OperatorSummary | null>(null);
  const [contact,    setContact]    = useState<Contact | null>(null);
  const [counties,   setCounties]   = useState<CountyRow[]>([]);
  const [topWells,   setTopWells]   = useState<TopWell[]>([]);
  const [dimensions, setDimensions] = useState<DimensionBreakdown | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [notFound,   setNotFound]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `operator_detail:${operator}`;

    function applyBundle(b: OperatorDetailBundle) {
      setSummary(b.summary);
      setContact(b.contact);
      setCounties(b.counties);
      setTopWells(b.topWells);
      setDimensions(b.dimensions);
    }

    async function load() {
      setLoading(true);
      setNotFound(false);

      const cached = await getCached<OperatorDetailBundle>(cacheKey, OPERATOR_DETAIL_VERSION, TTL_24H);
      if (cancelled) return;
      if (cached) {
        if (!cached.summary) { setNotFound(true); setLoading(false); return; }
        applyBundle(cached);
        setLoading(false);
        return;
      }

      const [sumRes, contactRes, countyRes, wellsRes, dimRes] = await Promise.all([
        supabase
          .from('operator_risk_summary')
          .select('*')
          .eq('operator', operator)
          .maybeSingle(),
        supabase
          .from('wells')
          .select('operator_address, operator_phone')
          .eq('operator', operator)
          .not('operator_address', 'is', null)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('operator_county_breakdown')
          .select('*')
          .eq('operator', operator)
          .order('wells', { ascending: false }),
        supabase
          .from('operator_well_details')
          .select('api_no, well_name, county, status, priority, composite_risk_score, total_depth')
          .eq('operator', operator)
          .not('composite_risk_score', 'is', null)
          .order('composite_risk_score', { ascending: false })
          .limit(25),
        supabase
          .from('operator_dimension_breakdown')
          .select('*')
          .eq('operator', operator)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (!sumRes.data) {
        await setCached<OperatorDetailBundle>(cacheKey, OPERATOR_DETAIL_VERSION, {
          summary: null, contact: null, counties: [], topWells: [], dimensions: null,
        });
        setNotFound(true);
        setLoading(false);
        return;
      }

      const bundle: OperatorDetailBundle = {
        summary:    sumRes.data as unknown as OperatorSummary,
        contact:    contactRes.data as unknown as Contact | null,
        counties:   (countyRes.data ?? []) as unknown as CountyRow[],
        topWells:   (wellsRes.data ?? []) as unknown as TopWell[],
        dimensions: dimRes.data as unknown as DimensionBreakdown | null,
      };
      applyBundle(bundle);
      setLoading(false);
      await setCached(cacheKey, OPERATOR_DETAIL_VERSION, bundle);
    }
    load();
    return () => { cancelled = true; };
  }, [operator]);

  const pctPlug = summary && summary.total_wells > 0
    ? Math.round((summary.plug_candidates / summary.total_wells) * 1000) / 10
    : 0;
  const hiddenOrphans = summary
    ? summary.zombie_producers + summary.paperwork_producers
    : 0;

  const isHistoric = operator === 'HISTORIC OWNER';

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">
      <SiteHeader title="Operator Detail" subtitle={operator} />

      {/* ── Title block ────────────────────────────────────────────────── */}
      <div className="px-6 py-6 border-b border-gray-800">
        <Link href="/operators" className="text-xs text-gray-500 hover:text-white transition-colors mb-3 inline-block">
          ← All operators
        </Link>
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-3 flex-wrap">
          {isHistoric && (
            <span className="px-2 py-1 text-xs rounded bg-orange-500/20 text-orange-300 border border-orange-500/40">
              HISTORIC
            </span>
          )}
          <span className={isHistoric ? 'text-orange-300' : 'text-white'}>{operator}</span>
        </h2>
        {contact && (contact.operator_address || contact.operator_phone) && (
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-400 flex-wrap">
            {contact.operator_address && <span>📍 {contact.operator_address}</span>}
            {contact.operator_phone && <span>📞 {contact.operator_phone}</span>}
          </div>
        )}
      </div>

      {loading && (
        <div className="px-6 py-10 text-gray-500 text-sm">Loading…</div>
      )}

      {!loading && notFound && (
        <div className="px-6 py-10 text-gray-500 text-sm">
          Operator <span className="text-white font-mono">{operator}</span> not found.
          <Link href="/operators" className="ml-3 text-blue-400 hover:underline">Back to list</Link>
        </div>
      )}

      {!loading && summary && (
        <>
          {/* ── Stats strip ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-px bg-gray-700 border-b border-gray-700">
            <StatCell label="Total Wells"      value={summary.total_wells}                         color="text-gray-200" />
            <StatCell label="Plug Candidates"  value={summary.plug_candidates}                     color="text-orange-400" />
            <StatCell label="% Plug"           value={pctPlug}  suffix="%" fractional
                      color={pctPlug >= 95 ? 'text-red-400' : pctPlug >= 80 ? 'text-orange-400' : 'text-yellow-400'} />
            <StatCell label="Active Producers" value={summary.active_producers}                    color="text-green-400" />
            <StatCell label="Hidden Orphans"   value={hiddenOrphans}                               color="text-rose-400" />
            <StatCell label="Critical + High"  value={summary.critical + summary.high}             color="text-red-400" />
            <StatCell label="Counties"         value={summary.counties_count}                      color="text-gray-300" />
            <StatCell label="Avg Composite"    value={summary.avg_composite ?? 0} fractional       color="text-yellow-400" />
          </div>

          {/* ── Risk dimension breakdown ───────────────────────────────── */}
          {dimensions && (
            <section className="px-6 pt-6">
              <div className="bg-gray-900 rounded border border-gray-800">
                <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Risk Dimension Breakdown</h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Average score (0–100) across {(dimensions.water_n ?? 0).toLocaleString()} scored wells · higher = more risk
                    </p>
                  </div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Composite = weighted avg (see % labels)
                  </span>
                </header>
                <div className="p-4 space-y-2">
                  {DIMENSIONS.map(dim => {
                    const val = (dimensions[dim.key] as number | null) ?? 0;
                    const width = Math.min(Math.max(val, 0), 100);
                    return (
                      <div key={dim.key} className="flex items-center gap-3 text-xs">
                        <div className="w-36 shrink-0">
                          <div className="font-medium" style={{ color: dim.color }}>{dim.label}</div>
                          <div className="text-[10px] text-gray-500">{dim.weight}% weight · {dim.blurb}</div>
                        </div>
                        <div className="flex-1 h-5 bg-gray-800 rounded overflow-hidden relative">
                          <div
                            className="h-full rounded transition-all"
                            style={{ width: `${width}%`, background: dim.color, opacity: 0.85 }}
                          />
                          {/* Tick marks at 25 / 50 / 75 for reference */}
                          {[25, 50, 75].map(t => (
                            <div
                              key={t}
                              className="absolute top-0 bottom-0 border-l border-gray-700"
                              style={{ left: `${t}%` }}
                            />
                          ))}
                        </div>
                        <div className="w-16 text-right font-mono font-semibold" style={{ color: dim.color }}>
                          {val.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <footer className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-500">
                  Tick marks at 25 · 50 · 75. Bars stay flat near zero for vegetation/terrain/emissions when those signals don&apos;t reach the well — water proximity drives most operators&apos; composite scores.
                </footer>
              </div>
            </section>
          )}

          {/* ── Body: 2-col grid ───────────────────────────────────────── */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            {/* Counties */}
            <section className="bg-gray-900 rounded border border-gray-800">
              <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Counties ({counties.length})</h3>
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Sorted by wells</span>
              </header>
              <div className="overflow-auto max-h-[60vh]">
                <table className="text-xs w-full">
                  <thead className="sticky top-0 bg-gray-800 text-gray-400">
                    <tr>
                      <Th align="left">County</Th>
                      <Th>Wells</Th>
                      <Th>Plug</Th>
                      <Th>Hidden</Th>
                      <Th>Crit</Th>
                      <Th>High</Th>
                      <Th>Med</Th>
                      <Th>Low</Th>
                      <Th>Avg</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {counties.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-6 text-gray-500">No county data.</td></tr>
                    ) : counties.map((c, i) => (
                      <tr key={c.county} className={i % 2 === 1 ? 'bg-gray-900/40' : ''}>
                        <td className="px-3 py-1 font-medium">
                          <Link
                            href={`/counties/${encodeURIComponent(c.county)}`}
                            className="hover:text-white hover:underline underline-offset-2"
                          >
                            {titleCase(c.county)}
                          </Link>
                        </td>
                        <td className="px-2 py-1 font-mono text-right">{c.wells.toLocaleString()}</td>
                        <td className="px-2 py-1 font-mono text-right text-orange-400">{c.plug_candidates.toLocaleString()}</td>
                        <td className="px-2 py-1 font-mono text-right text-rose-400">
                          {c.hidden_orphans > 0 ? c.hidden_orphans.toLocaleString() : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-2 py-1 font-mono text-right text-red-400">{c.critical || <span className="text-gray-700">—</span>}</td>
                        <td className="px-2 py-1 font-mono text-right text-orange-400">{c.high || <span className="text-gray-700">—</span>}</td>
                        <td className="px-2 py-1 font-mono text-right text-yellow-400">{c.medium || <span className="text-gray-700">—</span>}</td>
                        <td className="px-2 py-1 font-mono text-right text-gray-500">{c.low || <span className="text-gray-700">—</span>}</td>
                        <td className="px-2 py-1 font-mono text-right text-gray-400">
                          {c.avg_composite != null ? c.avg_composite.toFixed(1) : <span className="text-gray-700">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Right column: Status + Top wells */}
            <div className="flex flex-col gap-6 min-w-0">
              {/* Well classification — 6-way bucket (matches stats strip above) */}
              <section className="bg-gray-900 rounded border border-gray-800">
                <header className="px-4 py-3 border-b border-gray-800">
                  <h3 className="text-sm font-semibold">Well Classification</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    How this operator&apos;s {summary.total_wells.toLocaleString()} wells split across plugging-relevance buckets.
                  </p>
                </header>
                <div className="p-3">
                  <table className="text-xs w-full">
                    <tbody>
                      {(() => {
                        const classified = summary.plugged_wells + summary.active_producers
                                         + summary.aging_producers + summary.zombie_producers
                                         + summary.paperwork_producers;
                        const other = Math.max(summary.total_wells - classified, 0);
                        const buckets = [
                          {
                            label: 'Plugged',              hint: 'plug date recorded',                         count: summary.plugged_wells,        color: '#22c55e',
                            tooltip: 'Plugged: well has a plug date on record in ODNR. Already retired — surface and subsurface sealed. No further action needed.',
                          },
                          {
                            label: 'Producing (2020+)',      hint: 'Last production ≥ 2020',                  count: summary.active_producers,     color: '#9ca3af',
                            tooltip: "Status='Producing' in ODNR AND reported non-zero production in 2020 or later. A real operating well with recent revenue — not a plug candidate.",
                          },
                          {
                            label: 'Producing (2015–19)',    hint: 'Last production 2015–2019',               count: summary.aging_producers,      color: '#eab308',
                            tooltip: "Status='Producing' AND last reported production was 2015–2019. Recently productive but now quiet. May be winding down — worth monitoring for near-future plugging.",
                          },
                          {
                            label: 'Producing (<2015)',      hint: 'Last production before 2015',             count: summary.zombie_producers,     color: '#f97316',
                            tooltip: "Status='Producing' in ODNR, BUT last reported production was before 2015. Nominally active, yet has not produced oil or gas in 10+ years. The operator still exists on paper but the well is economically dead — hidden among 'active' wells.",
                          },
                          {
                            label: 'No production filed',    hint: 'No production year on record',            count: summary.paperwork_producers,  color: '#f43f5e',
                            tooltip: "Status='Producing' in ODNR, BUT zero production has ever been reported. The well was registered as producing, but no quarterly output has ever been filed. Exists only on paper.",
                          },
                          {
                            label: 'Other',                hint: 'permit-only, injection, storage, FI WNF, …', count: other,                        color: '#6b7280',
                            tooltip: 'Other: wells with statuses outside the main production lifecycle — Permit Expired, Well Drilled, Active Injection, Storage Well, Field Inspected / Well Not Found, Unknown status, Drilling, and similar. Each has its own regulatory path; most are not plug candidates for a training-crew program.',
                          },
                        ];
                        return buckets.map((b, i) => {
                          const pct = summary.total_wells > 0 ? b.count / summary.total_wells : 0;
                          return (
                            <tr
                              key={b.label}
                              title={b.tooltip}
                              className={`${i % 2 === 1 ? 'bg-gray-900/40' : ''} hover:bg-gray-800/60 transition-colors cursor-help`}
                            >
                              <td className="px-2 py-1.5">
                                <div className="font-medium" style={{ color: b.color }}>{b.label}</div>
                                <div className="text-[10px] text-gray-500">{b.hint}</div>
                              </td>
                              <td className="px-2 py-1.5 font-mono text-right w-16">{b.count.toLocaleString()}</td>
                              <td className="px-2 py-1.5 text-right w-44">
                                <div className="inline-block w-28 h-2 bg-gray-800 rounded overflow-hidden align-middle">
                                  <div className="h-full" style={{ width: `${Math.max(pct * 100, b.count > 0 ? 1 : 0)}%`, background: b.color, opacity: 0.9 }} />
                                </div>
                                <span className="text-[10px] text-gray-500 ml-2 font-mono">{(pct * 100).toFixed(1)}%</span>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Top wells */}
              <section className="bg-gray-900 rounded border border-gray-800 flex-1">
                <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Top {topWells.length} Wells by Composite Risk</h3>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Higher = more urgent</span>
                </header>
                <div className="overflow-auto max-h-[45vh]">
                  <table className="text-xs w-full">
                    <thead className="sticky top-0 bg-gray-800 text-gray-400">
                      <tr>
                        <Th align="left">Score</Th>
                        <Th align="left">Priority</Th>
                        <Th align="left">Well</Th>
                        <Th align="left">County</Th>
                        <Th align="left">Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {topWells.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-6 text-gray-500">No scored wells.</td></tr>
                      ) : topWells.map((w, i) => (
                        <tr key={w.api_no} className={i % 2 === 1 ? 'bg-gray-900/40' : ''}>
                          <td className="px-3 py-1 font-mono font-semibold" style={{ color: priorityColor(w.priority) }}>
                            {w.composite_risk_score != null ? w.composite_risk_score.toFixed(0) : '—'}
                          </td>
                          <td className="px-2 py-1">
                            {w.priority ? (
                              <span className="px-1.5 py-0.5 text-[10px] rounded uppercase tracking-wide font-semibold"
                                    style={{ background: priorityColor(w.priority), color: '#000' }}>
                                {w.priority}
                              </span>
                            ) : <span className="text-gray-700">—</span>}
                          </td>
                          <td className="px-2 py-1 truncate max-w-[14rem]" title={w.well_name ?? w.api_no}>
                            <Link href={`/wells/${encodeURIComponent(w.api_no)}`} className="text-gray-200 hover:text-white hover:underline">
                              {w.well_name ?? w.api_no}
                            </Link>
                          </td>
                          <td className="px-2 py-1 text-gray-400">{w.county ? titleCase(w.county) : '—'}</td>
                          <td className="px-2 py-1 text-gray-500">{w.status ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children, align = 'right' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-2 py-2 font-medium uppercase tracking-wider whitespace-nowrap border-b border-gray-700 ${align === 'right' ? 'text-right' : 'text-left'}`}
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
  value: number;
  color: string;
  suffix?: string;
  fractional?: boolean;
}) {
  return (
    <div className="bg-gray-900 px-4 py-3">
      <div className="text-gray-500 uppercase tracking-wider" style={{ fontSize: '10px' }}>{label}</div>
      <div className={`font-mono font-semibold mt-1 text-lg ${color}`}>
        {fractional ? value.toFixed(1) : value.toLocaleString()}{suffix || ''}
      </div>
    </div>
  );
}
