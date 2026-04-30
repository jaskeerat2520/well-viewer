'use client';

import { use, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import SiteHeader from '@/components/SiteHeader';

const OsipThumb = dynamic(() => import('@/components/OsipThumb'), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────

interface WellRow {
  api_no: string;
  well_name: string | null;
  operator: string | null;
  operator_address: string | null;
  operator_phone: string | null;
  county: string | null;
  township: string | null;
  status: string | null;
  well_type: string | null;
  lease_name: string | null;
  well_number: string | null;
  orphan_status: string | null;
  in_orphan_program: boolean | null;
  lat: number | null;
  lng: number | null;
  bh_lat: number | null;
  bh_lng: number | null;
  total_depth: number | null;
  deepest_formation: string | null;
  prod_formation_1: string | null;
  prod_formation_2: string | null;
  acreage: number | null;
  elevation: number | null;
  slant: string | null;
  ip_oil: number | null;
  ip_gas: number | null;
  has_geophys_log: boolean | null;
  permit_issued: string | null;
  completion_date: string | null;
  plug_date: string | null;
  last_nonzero_production_year: number | null;
  last_production_quarter: string | null;
}

interface RiskRow {
  api_no: string;
  priority: string | null;
  composite_risk_score: number | null;
  water_risk_score: number | null;
  population_risk_score: number | null;
  vegetation_risk_score: number | null;
  terrain_risk_score: number | null;
  emissions_risk_score: number | null;
  inactivity_score: number | null;
  nearest_water_distance_m: number | null;
  nearest_water_type: string | null;
  within_protection_zone: boolean | null;
  population_within_1km: number | null;
  population_within_5km: number | null;
  years_inactive: number | null;
  // Landowner metadata (NULL for wells whose county hasn't had parcels loaded
  // yet; surface_owner_name additionally NULL outside Hocking until per-county
  // auditor pulls happen).
  surface_owner_name: string | null;
  surface_owner_mailing_state: string | null;
  surface_parcel_id: string | null;
  surface_parcel_acreage: number | null;
  historical_mineral_lessor: string | null;
  is_severed_estate: boolean | null;
  // Lessor successor info (from defunct_lessor_successors via
  // well_risk_with_successor view). NULL for wells whose lessor isn't in
  // the manual research table — most wells fall into that bucket because
  // only defunct corporate lessors have entries.
  successor_status: string | null;
  successor_entity: string | null;
  successor_ticker: string | null;
  // Evidence supporting the successor classification.
  successor_source_url:  string | null;
  successor_verification: string | null;
  computed_at: string | null;
}

interface AdminStatusRow {
  api_no: string;
  operator_status: string | null;
}

interface RemoteSensingRow {
  api_no: string;
  mean_slope_well: number | null;
  mean_slope_bg: number | null;
  slope_ratio: number | null;
  is_artificially_flat: boolean | null;
  terrain_risk_score: number | null;
  ch4_well_ppb: number | null;
  ch4_background_ppb: number | null;
  ch4_anomaly_ratio: number | null;
  ch4_is_anomaly: boolean | null;
  ch4_signal_source: string | null;
  thermal_well_c: number | null;
  thermal_background_c: number | null;
  thermal_anomaly_c: number | null;
  emissions_risk_score: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function priorityColor(p: string | null): string {
  if (p === 'critical') return '#ef4444';
  if (p === 'high')     return '#f97316';
  if (p === 'medium')   return '#eab308';
  if (p === 'low')      return '#6b7280';
  return '#374151';
}

function classify(status: string | null, lastProd: number | null, plugDate: string | null):
  { label: string; color: string; tooltip: string } {
  if (plugDate)                             return { label: 'Plugged',             color: '#22c55e', tooltip: 'Plug date on record. Already retired.' };
  if (status === 'Producing') {
    if (lastProd == null)                   return { label: 'No production filed', color: '#f43f5e', tooltip: "Status='Producing' but zero production has ever been reported. Exists only on paper." };
    if (lastProd >= 2020)                   return { label: 'Producing (2020+)',   color: '#9ca3af', tooltip: "Status='Producing' AND reported non-zero production in 2020 or later." };
    if (lastProd >= 2015)                   return { label: 'Producing (2015–19)', color: '#eab308', tooltip: "Status='Producing' AND last production was 2015–2019. Winding down." };
    return                                         { label: 'Producing (<2015)',   color: '#f97316', tooltip: "Status='Producing' BUT last production was before 2015. Hidden among 'active' wells — economically dead but still on paper." };
  }
  return { label: status ?? 'Unknown', color: '#6b7280', tooltip: 'Status outside the main production lifecycle (permit, injection, storage, FI WNF, etc.).' };
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Dimensions — weights match CLAUDE.md / compute_composite.py.
// Inactivity (10%) was added when score_population.py rebalanced water 30→25
// and population 20→15. Update both this list and compute_composite.py
// together if weights change again.
type DimKey = 'water_risk_score' | 'population_risk_score' | 'vegetation_risk_score' | 'terrain_risk_score' | 'emissions_risk_score' | 'inactivity_score';
const DIMENSIONS: { key: DimKey; label: string; weight: number; color: string; blurb: string }[] = [
  { key: 'water_risk_score',      label: 'Water',      weight: 25, color: '#60a5fa', blurb: 'proximity to drinking-water protection zones' },
  { key: 'population_risk_score', label: 'Population', weight: 15, color: '#c084fc', blurb: 'people within 1 km / 5 km' },
  { key: 'vegetation_risk_score', label: 'Vegetation', weight: 20, color: '#4ade80', blurb: 'NDVI anomaly + multi-year trend (Sentinel-2)' },
  { key: 'terrain_risk_score',    label: 'Terrain',    weight: 10, color: '#fbbf24', blurb: 'artificial-pad detection (3DEP slope ratio)' },
  { key: 'emissions_risk_score',  label: 'Emissions',  weight: 20, color: '#f87171', blurb: 'CH4 (Sentinel-5P) + thermal (Landsat 9)' },
  { key: 'inactivity_score',      label: 'Inactivity', weight: 10, color: '#94a3b8', blurb: 'years since last reported production' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WellDetailPage({
  params,
}: {
  params: Promise<{ api: string }>;
}) {
  const { api: rawApi } = use(params);
  const api = safeDecode(rawApi);

  const [well,     setWell]     = useState<WellRow | null>(null);
  const [risk,     setRisk]     = useState<RiskRow | null>(null);
  const [rs,       setRs]       = useState<RemoteSensingRow | null>(null);
  const [admin,    setAdmin]    = useState<AdminStatusRow | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotFound(false);
      const [wellRes, riskRes, rsRes, adminRes] = await Promise.all([
        supabase.from('wells').select('*').eq('api_no', api).maybeSingle(),
        supabase.from('well_risk_with_successor').select('*').eq('api_no', api).maybeSingle(),
        supabase.from('well_remote_sensing').select('*').eq('api_no', api).maybeSingle(),
        supabase.from('well_admin_status').select('*').eq('api_no', api).maybeSingle(),
      ]);
      if (cancelled) return;
      if (!wellRes.data) { setNotFound(true); setLoading(false); return; }
      setWell(wellRes.data as unknown as WellRow);
      setRisk(riskRes.data as unknown as RiskRow | null);
      setRs(rsRes.data as unknown as RemoteSensingRow | null);
      setAdmin(adminRes.data as unknown as AdminStatusRow | null);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [api]);

  const classification = well
    ? classify(well.status, well.last_nonzero_production_year, well.plug_date)
    : null;

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">
      <SiteHeader title="Well Detail" subtitle={well?.well_name ?? api} />

      {loading && <div className="px-6 py-10 text-gray-500 text-sm">Loading…</div>}

      {!loading && notFound && (
        <div className="px-6 py-10 text-gray-500 text-sm">
          Well API <span className="text-white font-mono">{api}</span> not found.
          <Link href="/table" className="ml-3 text-blue-400 hover:underline">Back to table</Link>
        </div>
      )}

      {!loading && well && (
        <>
          {/* ── Title block ──────────────────────────────────────────────── */}
          <div className="px-6 py-6 border-b border-gray-800 flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                <Link href="/table" className="hover:text-white transition-colors">← All wells</Link>
                {well.county && (
                  <>
                    <span>·</span>
                    <Link href={`/counties/${encodeURIComponent(well.county)}`} className="hover:text-white transition-colors">
                      {titleCase(well.county)} County
                    </Link>
                  </>
                )}
                {well.operator && (
                  <>
                    <span>·</span>
                    <Link href={`/operators/${encodeURIComponent(well.operator)}`} className="hover:text-white transition-colors">
                      {well.operator}
                    </Link>
                  </>
                )}
              </div>

              <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-3 flex-wrap">
                {risk?.priority && (
                  <span
                    className="px-2 py-1 text-xs rounded uppercase tracking-wide font-semibold"
                    style={{ background: priorityColor(risk.priority), color: '#000' }}
                  >
                    {risk.priority}
                  </span>
                )}
                <span>{well.well_name ?? '(unnamed well)'}</span>
              </h2>
              <div className="mt-1 text-xs text-gray-400 font-mono">API {well.api_no}</div>
            </div>

            {/* See More / View on Map */}
            {well.lat != null && well.lng != null && (
              <Link
                href={`/?lat=${well.lat}&lng=${well.lng}&api=${encodeURIComponent(well.api_no)}`}
                className="shrink-0 px-3 py-2 rounded text-xs font-medium border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 hover:text-blue-200 transition-colors inline-flex items-center gap-2"
                title="Open this well in the main interactive map, centered on its coordinates"
              >
                📍 View on Map →
              </Link>
            )}
          </div>

          {/* ── Headline stats strip ─────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-px bg-gray-700 border-b border-gray-700">
            <StatCell
              label="Composite"
              value={risk?.composite_risk_score != null ? risk.composite_risk_score.toFixed(1) : '—'}
              colorStyle={{ color: risk?.priority ? priorityColor(risk.priority) : '#9ca3af' }}
            />
            <StatCell
              label="Classification"
              value={classification?.label ?? '—'}
              colorStyle={{ color: classification?.color ?? '#9ca3af' }}
              tooltip={classification?.tooltip}
              small
            />
            <StatCell label="Status"       value={well.status ?? '—'} colorStyle={{ color: '#d1d5db' }} small />
            <StatCell label="Depth (ft)"   value={well.total_depth?.toLocaleString() ?? '—'} colorStyle={{ color: '#d1d5db' }} />
            <StatCell label="Well Type"    value={well.well_type ?? '—'} colorStyle={{ color: '#d1d5db' }} small />
            <StatCell label="Last Production" value={well.last_nonzero_production_year?.toString() ?? '—'} colorStyle={{ color: '#d1d5db' }} />
            <StatCell label="Years Inactive"  value={risk?.years_inactive?.toFixed(1) ?? '—'} colorStyle={{ color: '#d1d5db' }} />
          </div>

          {/* ── Risk dimension breakdown ──────────────────────────────── */}
          {risk && (
            <section className="px-6 pt-6">
              <div className="bg-gray-900 rounded border border-gray-800">
                <header className="px-4 py-3 border-b border-gray-800">
                  <h3 className="text-sm font-semibold">Risk Dimension Scores</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    This well&apos;s individual scores (0–100). Composite is the weighted average.
                  </p>
                </header>
                <div className="p-4 space-y-2">
                  {DIMENSIONS.map(dim => {
                    const val = risk[dim.key] ?? 0;
                    const width = Math.min(Math.max(val, 0), 100);
                    const missing = risk[dim.key] == null;
                    return (
                      <div key={dim.key} className="flex items-center gap-3 text-xs">
                        <div className="w-40 shrink-0">
                          <div className="font-medium" style={{ color: dim.color, opacity: missing ? 0.5 : 1 }}>{dim.label}</div>
                          <div className="text-[10px] text-gray-500">{dim.weight}% weight · {dim.blurb}</div>
                        </div>
                        <div className="flex-1 h-5 bg-gray-800 rounded overflow-hidden relative">
                          <div className="h-full rounded" style={{ width: `${width}%`, background: dim.color, opacity: missing ? 0.25 : 0.85 }} />
                          {[25, 50, 75].map(t => (
                            <div key={t} className="absolute top-0 bottom-0 border-l border-gray-700" style={{ left: `${t}%` }} />
                          ))}
                        </div>
                        <div className="w-16 text-right font-mono font-semibold" style={{ color: dim.color, opacity: missing ? 0.5 : 1 }}>
                          {missing ? '—' : val.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ── Wellspan timeline ─────────────────────────────────────── */}
          <section className="px-6 pt-6">
            <Panel title="Wellspan">
              <WellspanTimeline well={well} />
            </Panel>
          </section>

          {/* ── Two-col body ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            {/* Location & Operator */}
            <Panel title="Location & Operator">
              <KV label="County">
                {well.county ? (
                  <Link href={`/counties/${encodeURIComponent(well.county)}`} className="text-blue-300 hover:underline">
                    {titleCase(well.county)}
                  </Link>
                ) : '—'}
              </KV>
              <KV label="Township">{well.township ?? '—'}</KV>
              <KV label="Lat, Lng">
                {well.lat != null && well.lng != null ? (
                  well.county ? (
                    <Link
                      href={`/counties/${encodeURIComponent(well.county)}#wells-map`}
                      className="font-mono text-blue-300 hover:underline"
                      title={`Locate this well on the ${titleCase(well.county)} County aerial map`}
                    >
                      {well.lat.toFixed(6)}, {well.lng.toFixed(6)} →
                    </Link>
                  ) : (
                    <span className="font-mono">{well.lat.toFixed(6)}, {well.lng.toFixed(6)}</span>
                  )
                ) : '—'}
              </KV>
              {well.lat != null && well.lng != null && (
                <KV label="External">
                  <a
                    href={`https://www.google.com/maps/@${well.lat},${well.lng},18z/data=!3m1!1e3`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-blue-300 hover:underline text-[11px]"
                  >
                    Google satellite ↗
                  </a>
                </KV>
              )}
              <div className="h-px bg-gray-800 my-2" />
              <KV label="Operator">
                {well.operator ? (
                  <Link href={`/operators/${encodeURIComponent(well.operator)}`} className="text-blue-300 hover:underline">
                    {well.operator}
                  </Link>
                ) : '—'}
              </KV>
              <KV label="Address">{well.operator_address ?? '—'}</KV>
              <KV label="Phone">{well.operator_phone ?? '—'}</KV>
              <KV label="Lease">{well.lease_name ?? '—'}</KV>
              <KV label="Well number">{well.well_number ?? '—'}</KV>
              <KV label="Lease acreage">{well.acreage != null ? `${well.acreage.toFixed(1)} ac` : '—'}</KV>
              <KV label="Orphan Program">
                {well.in_orphan_program ? <span className="text-red-300">✓ Enrolled</span> : <span className="text-gray-500">No</span>}
              </KV>
              {admin?.operator_status && admin.operator_status !== 'active' && (
                <KV label="Admin classification">
                  <span className="text-amber-300">{admin.operator_status.replace(/_/g, ' ')}</span>
                </KV>
              )}
              {well.bh_lat != null && well.bh_lng != null
                && (well.bh_lat !== well.lat || well.bh_lng !== well.lng) && (
                <KV label="Bottom hole">
                  <span className="font-mono text-[11px]">{well.bh_lat.toFixed(6)}, {well.bh_lng.toFixed(6)}</span>
                  <span className="ml-2 text-[10px] text-gray-500">(directional)</span>
                </KV>
              )}
              {well.operator && (
                <div className="mt-3 pt-3 border-t border-gray-800 text-[10px] leading-relaxed text-gray-500">
                  <span className="font-semibold text-gray-400">Operator-of-record</span> per
                  Ohio DNR&rsquo;s Risk-Based Data Management System filing. This is the
                  legal record ODNR uses for compliance notices, production reports, and
                  plugging-liability enforcement &mdash; the operator named here is the
                  party currently on the hook for the well.
                </div>
              )}
            </Panel>

            {/* Timeline */}
            <Panel title="Timeline">
              <KV label="Permit issued">{formatDate(well.permit_issued)}</KV>
              <KV label="Completion">{formatDate(well.completion_date)}</KV>
              <KV label="Last production">
                {well.last_nonzero_production_year
                  ? `${well.last_nonzero_production_year}${well.last_production_quarter ? ` (${well.last_production_quarter})` : ''}`
                  : <span className="text-gray-500">None on record</span>}
              </KV>
              <KV label="Years inactive">
                {risk?.years_inactive != null ? risk.years_inactive.toFixed(1) : '—'}
              </KV>
              <KV label="Plug date">
                {well.plug_date
                  ? <span className="text-green-400">{formatDate(well.plug_date)}</span>
                  : <span className="text-red-300">Not plugged</span>}
              </KV>
              <div className="h-px bg-gray-800 my-2" />
              <KV label="Deepest formation">{well.deepest_formation ?? '—'}</KV>
              <KV label="Producing formation">
                {well.prod_formation_1
                  ? <>{well.prod_formation_1}{well.prod_formation_2 ? `, ${well.prod_formation_2}` : ''}</>
                  : '—'}
              </KV>
              <KV label="Slant">{well.slant ?? '—'}</KV>
              <KV label="Elevation (ft)">{well.elevation?.toLocaleString() ?? '—'}</KV>
              <div className="h-px bg-gray-800 my-2" />
              <KV label="Initial production">
                {well.ip_oil != null || well.ip_gas != null ? (
                  <>
                    {well.ip_oil != null && <>{well.ip_oil.toLocaleString()} bbl oil</>}
                    {well.ip_oil != null && well.ip_gas != null && <span className="text-gray-500"> · </span>}
                    {well.ip_gas != null && <>{well.ip_gas.toLocaleString()} mcf gas</>}
                  </>
                ) : <span className="text-gray-500">Not reported</span>}
              </KV>
              <KV label="Geophysical log">
                {well.has_geophys_log === true ? <span className="text-green-400">✓ On file</span>
                 : well.has_geophys_log === false ? <span className="text-gray-500">No</span>
                 : <span className="text-gray-500">—</span>}
              </KV>
            </Panel>
          </div>

          {/* ── Surface Landowner & Mineral Rights ────────────────────── */}
          {risk && (risk.surface_owner_name || risk.surface_parcel_id || risk.historical_mineral_lessor) && (
            <section className="px-6 pb-6">
              <Panel title="Surface Landowner & Mineral Rights">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wider text-emerald-400 mb-2">Surface Owner</h4>
                    <KV label="Owner">
                      {risk.surface_owner_name
                        ? risk.surface_owner_name
                        : <span className="text-gray-500">Not resolved (county not yet ingested for owner names)</span>}
                    </KV>
                    <KV label="Parcel ID">
                      {risk.surface_parcel_id
                        ? <span className="font-mono">{risk.surface_parcel_id}</span>
                        : '—'}
                    </KV>
                    <KV label="Parcel acreage">
                      {risk.surface_parcel_acreage != null
                        ? `${risk.surface_parcel_acreage.toFixed(1)} ac`
                        : '—'}
                    </KV>
                    <KV label="Owner mailing">
                      {risk.surface_owner_mailing_state ? (
                        <>
                          <span>{risk.surface_owner_mailing_state}</span>
                          {risk.surface_owner_mailing_state !== 'OH' && (
                            <span className="ml-2 text-[10px] text-amber-300">(out of state)</span>
                          )}
                        </>
                      ) : <span className="text-gray-500">—</span>}
                    </KV>
                  </div>
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wider text-amber-400 mb-2">Historical Mineral Rights</h4>
                    <KV label="Lessor at permit">
                      {risk.historical_mineral_lessor
                        ? risk.historical_mineral_lessor
                        : <span className="text-gray-500">No lease name on record</span>}
                    </KV>
                    <KV label="Estate severed">
                      {risk.is_severed_estate === true
                        ? <span className="text-amber-300">Yes — surface ≠ historical lessor</span>
                        : risk.is_severed_estate === false
                        ? <span className="text-green-400">United (surface = historical lessor)</span>
                        : <span className="text-gray-500">—</span>}
                    </KV>
                    {risk.successor_status && (
                      <>
                        <KV label="Lessor today">
                          <span style={{
                            color: risk.successor_status === 'living_successor' ? '#22c55e'
                                 : risk.successor_status === 'partial_successor' ? '#84cc16'
                                 : risk.successor_status === 'dissolved_no_successor' ? '#ef4444'
                                 : risk.successor_status === 'individual_lessor' ? '#a855f7'
                                 : '#9ca3af'
                          }}>
                            {risk.successor_status === 'living_successor' && '✓ Living: '}
                            {risk.successor_status === 'partial_successor' && '~ Partial: '}
                            {risk.successor_status === 'dissolved_no_successor' && '✗ Dissolved'}
                            {risk.successor_status === 'individual_lessor' && '◇ Individual lessor'}
                            {risk.successor_status === 'unclear' && '? Unclear'}
                            {risk.successor_entity && (
                              <>
                                {risk.successor_entity}
                                {risk.successor_ticker && (
                                  <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(risk.successor_ticker)}`}
                                     target="_blank" rel="noopener noreferrer"
                                     className="ml-1 text-emerald-400 hover:underline font-mono"
                                     title={`Open ${risk.successor_ticker} on Yahoo Finance — a working quote page is direct proof the company trades today`}>
                                    ({risk.successor_ticker} ↗)
                                  </a>
                                )}
                              </>
                            )}
                          </span>
                        </KV>
                        <KV label="Evidence">
                          <SuccessorEvidence
                            method={risk.successor_verification}
                            sourceUrl={risk.successor_source_url}
                            lessorName={risk.historical_mineral_lessor}
                            ticker={risk.successor_ticker}
                            successorStatus={risk.successor_status}
                            operator={well.operator}
                          />
                        </KV>
                      </>
                    )}
                    <div className="text-[10px] text-gray-500 mt-2 leading-snug">
                      Lessor is the mineral-rights owner at time of permit — often a defunct
                      coal company or a long-deceased individual for legacy wells. Severed
                      means the mineral estate has separated from the surface estate.
                      &quot;Lessor today&quot; surfaces our research on whether the original lessor
                      has a living corporate successor (potential legal liability path).
                      &quot;Evidence&quot; distinguishes researched citations from pattern-inferred
                      classifications — verify pattern-classified entries on the Ohio
                      Secretary of State business registry before any legal action.
                    </div>
                    <div className="text-[10px] text-amber-400/80 mt-2 leading-snug border-l-2 border-amber-700/40 pl-2">
                      <span className="uppercase tracking-wider font-semibold">Important: </span>
                      The <span className="text-white">company verified / researched / unverified</span> pill
                      describes only whether the named successor entity is a real, traceable company today.
                      It does <span className="text-white">not</span> confirm that the company has inherited
                      statutory plugging duty for this well. Under{' '}
                      <a href="https://codes.ohio.gov/ohio-revised-code/section-1509.062" target="_blank" rel="noopener noreferrer"
                         className="text-blue-300 hover:underline">
                        ORC 1509
                      </a>
                      , the operator (not the underlying mineral-rights lessor) is the
                      primary party responsible for plugging. Lessor-successor liability for wells the lessor
                      never operated is a secondary theory and is not established by the source links here —
                      Wikipedia entries establish corporate lineage at the brand level, not legal succession of
                      well-specific obligations.
                    </div>
                  </div>
                </div>
              </Panel>
            </section>
          )}

          {/* ── Water & Population Exposure ───────────────────────────── */}
          {risk && (
            <section className="px-6 pb-6">
              <Panel title="Water & Population Exposure">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <ExposureCell
                    label="Protection zone"
                    value={risk.within_protection_zone === true ? 'Inside zone' : risk.within_protection_zone === false ? 'Outside' : '—'}
                    color={risk.within_protection_zone ? '#60a5fa' : '#6b7280'}
                  />
                  <ExposureCell
                    label="Nearest water"
                    value={risk.nearest_water_distance_m != null ? `${risk.nearest_water_distance_m.toFixed(0)} m` : '—'}
                    sub={risk.nearest_water_type ?? undefined}
                    color="#60a5fa"
                  />
                  <ExposureCell
                    label="Population 1 km"
                    value={risk.population_within_1km?.toLocaleString() ?? '—'}
                    color="#c084fc"
                  />
                  <ExposureCell
                    label="Population 5 km"
                    value={risk.population_within_5km?.toLocaleString() ?? '—'}
                    color="#c084fc"
                  />
                </div>
              </Panel>
            </section>
          )}

          {/* ── Remote Sensing ────────────────────────────────────────── */}
          {rs && (
            <section className="px-6 pb-8">
              <Panel title="Satellite Remote-Sensing Signals">
                {/* Visual ground-truth: Ohio OSIP aerial imagery (6 in – 1 ft).
                    Sits next to the spectral/thermal signals so you can eyeball
                    pads, tanks, and access roads while reading the numbers. */}
                {well.lat != null && well.lng != null && (
                  <div className="mb-5">
                    <h4 className="text-[11px] uppercase tracking-wider text-yellow-400 mb-2">
                      Ground truth — Ohio OSIP aerial
                    </h4>
                    <OsipThumb lat={well.lat} lng={well.lng} height={360} />
                    <p className="text-[10px] text-gray-500 mt-1.5 leading-tight">
                      Drag to pan, scroll to zoom. OSIP refreshes every few years; use it to confirm
                      visible features (tank battery, fresh disturbance, vegetation around the pad)
                      against the spectral anomalies below.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Terrain */}
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wider text-amber-400 mb-2">Terrain (3DEP DEM)</h4>
                    <KV label="Slope ratio">
                      {rs.slope_ratio != null ? rs.slope_ratio.toFixed(2) : '—'}
                      {rs.is_artificially_flat && <span className="ml-2 text-[10px] text-amber-300">(flat)</span>}
                    </KV>
                    <KV label="Well slope">{rs.mean_slope_well != null ? `${rs.mean_slope_well.toFixed(2)}°` : '—'}</KV>
                    <KV label="Background slope">{rs.mean_slope_bg != null ? `${rs.mean_slope_bg.toFixed(2)}°` : '—'}</KV>
                    <KV label="Terrain score">
                      <span style={{ color: (rs.terrain_risk_score ?? 0) >= 50 ? '#fbbf24' : '#9ca3af' }}>
                        {rs.terrain_risk_score ?? '—'}
                      </span>
                    </KV>
                  </div>

                  {/* CH4 */}
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wider text-red-400 mb-2">Methane (Sentinel-5P)</h4>
                    <KV label="Well CH4">{rs.ch4_well_ppb != null ? `${rs.ch4_well_ppb.toFixed(1)} ppb` : '—'}</KV>
                    <KV label="Background">{rs.ch4_background_ppb != null ? `${rs.ch4_background_ppb.toFixed(1)} ppb` : '—'}</KV>
                    <KV label="Ratio">
                      {rs.ch4_anomaly_ratio != null ? (
                        <span style={{ color: rs.ch4_is_anomaly ? '#f87171' : '#9ca3af' }}>
                          {rs.ch4_anomaly_ratio.toFixed(2)}×
                          {rs.ch4_is_anomaly && <span className="ml-2 text-[10px] text-red-300">(anomaly)</span>}
                        </span>
                      ) : '—'}
                    </KV>
                    <KV label="Signal source">{rs.ch4_signal_source ?? '—'}</KV>
                  </div>

                  {/* Thermal */}
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wider text-orange-400 mb-2">Thermal (Landsat 9)</h4>
                    <KV label="Well temp">{rs.thermal_well_c != null ? `${rs.thermal_well_c.toFixed(1)} °C` : '—'}</KV>
                    <KV label="Background">{rs.thermal_background_c != null ? `${rs.thermal_background_c.toFixed(1)} °C` : '—'}</KV>
                    <KV label="Anomaly Δ">
                      {rs.thermal_anomaly_c != null ? (
                        <span style={{ color: rs.thermal_anomaly_c >= 5 ? '#ef4444' : rs.thermal_anomaly_c >= 2 ? '#fb923c' : '#9ca3af' }}>
                          {rs.thermal_anomaly_c >= 0 ? '+' : ''}{rs.thermal_anomaly_c.toFixed(2)} °C
                        </span>
                      ) : '—'}
                    </KV>
                    <KV label="Emissions score">
                      <span style={{ color: (rs.emissions_risk_score ?? 0) >= 50 ? '#f43f5e' : '#9ca3af' }}>
                        {rs.emissions_risk_score ?? '—'}
                      </span>
                    </KV>
                  </div>
                </div>
              </Panel>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────────────────

function StatCell({
  label, value, colorStyle, tooltip, small,
}: {
  label: string;
  value: string;
  colorStyle?: React.CSSProperties;
  tooltip?: string;
  small?: boolean;
}) {
  return (
    <div className="bg-gray-900 px-4 py-3" title={tooltip} style={tooltip ? { cursor: 'help' } : undefined}>
      <div className="text-gray-500 uppercase tracking-wider" style={{ fontSize: '10px' }}>{label}</div>
      <div
        className={`font-mono font-semibold mt-1 ${small ? 'text-sm' : 'text-lg'}`}
        style={colorStyle}
      >
        {value}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded border border-gray-800">
      <header className="px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="p-4 text-xs space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-36 shrink-0 text-gray-500 uppercase tracking-wider text-[10px] pt-0.5">{label}</div>
      <div className="flex-1 text-gray-200 min-w-0 break-words">{children}</div>
    </div>
  );
}

// Compact evidence display for a successor classification. Renders:
//  - A color-coded badge for verification method (Researched / Pattern / Unverified)
//  - An "evidence strength" pill (strong/medium/weak) — derived rollup of
//    {verification, source URL, ticker} so the user can scan credibility at a glance
//    without parsing each sub-field. Only shown for living/partial successors —
//    those are the rows where strength actually matters.
//  - Domain-labelled source link ("Source: en.wikipedia.org ↗") so the
//    reader can judge the source's credibility before clicking
//  - Explicit "Source: missing" tag when verification claims web_research but
//    no URL was captured — a data-quality gap the old UI hid silently
//  - "Verify on OH SoS ↗" deep-link to a Google site-search of OH Sec of State
//    pre-filled with the lessor name (direct OH SoS deep-links don't work
//    reliably because their UI is JS-rendered)
function SuccessorEvidence({
  method, sourceUrl, lessorName, ticker, successorStatus, operator,
}: {
  method: string | null;
  sourceUrl: string | null;
  lessorName: string | null;
  ticker?: string | null;
  successorStatus?: string | null;
  operator?: string | null;
}) {
  const badge =
    method === 'web_research'      ? { label: 'Researched',          color: '#22c55e' }
    : method === 'pattern_classified' ? { label: 'Pattern-inferred', color: '#eab308' }
    : method === 'oh_sos_verified' ? { label: 'OH SoS verified',     color: '#3b82f6' }
    :                                { label: 'Unverified',          color: '#9ca3af' };

  // Old version used a Google site-search of businesssearch.ohiosos.gov. That's
  // structurally broken: the SoS UI is JS-rendered, so Google can't crawl
  // results pages — the search returns 0 hits for almost every entity, even
  // ones that do exist in the registry. Use OpenCorporates (real HTML, indexes
  // OH + 130 other jurisdictions) for an actual auto-search; link the SoS
  // homepage as a manual-paste fallback.
  const openCorpUrl = lessorName
    ? `https://opencorporates.com/companies?q=${encodeURIComponent(lessorName)}`
    : null;
  const sosHomepageUrl = 'https://businesssearch.ohiosos.gov/';

  // Pill describes ONLY whether the successor company is reachable today.
  // It does not claim the company has inherited statutory plugging duty —
  // see the per-pill tooltip and the well-detail explanatory paragraph below.
  const showLevel = successorStatus === 'living_successor' || successorStatus === 'partial_successor';
  const researched = method === 'web_research' || method === 'oh_sos_verified';
  const level: 'verified' | 'researched' | 'unverified' =
    researched && sourceUrl && ticker ? 'verified'
    : !method || method === 'unverified' ? 'unverified'
    : method === 'pattern_classified' && !sourceUrl ? 'unverified'
    : 'researched';
  const levelColor = level === 'verified' ? '#22c55e' : level === 'researched' ? '#eab308' : '#9ca3af';
  const operatorPart = operator
    ? `Operator ${operator} is the primary statutory liable party under ORC 1509.`
    : 'The well operator (not the lessor) is the primary statutory liable party under ORC 1509.';
  const levelTooltip =
    `Pill scope: confirms the named successor company exists and is reachable. `
    + `Does NOT confirm that this company has inherited plugging duty for this specific well. `
    + operatorPart
    + ` Signals: verification=${method ?? 'none'}, source=${sourceUrl ? 'yes' : 'no'}, ticker=${ticker ?? 'no'}.`;

  let sourceHost: string | null = null;
  if (sourceUrl) {
    try { sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch { sourceHost = null; }
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold"
            style={{ background: badge.color, color: '#000' }}>
        {badge.label}
      </span>
      {showLevel && (
        <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold cursor-help"
              style={{ background: levelColor, color: '#000' }}
              title={levelTooltip}>
          company {level}
        </span>
      )}
      {sourceUrl ? (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
           className="text-blue-300 hover:underline text-[11px]"
           title={sourceUrl}>
          Source: {sourceHost ?? 'link'} ↗
        </a>
      ) : (
        method === 'web_research' && (
          <span className="text-[11px] text-orange-400/80"
                title="Marked Researched but no source URL was captured. Treat the successor mapping as unverifiable until a source is added.">
            Source: missing
          </span>
        )
      )}
      {openCorpUrl && (
        <a href={openCorpUrl} target="_blank" rel="noopener noreferrer"
           className="text-blue-300 hover:underline text-[11px]"
           title="Search OpenCorporates (US + UK + 130 jurisdictions) — catches Delaware/Illinois-incorporated coal companies that may not appear in the OH SoS registry">
          OpenCorps ↗
        </a>
      )}
      {lessorName && (
        <a href={sosHomepageUrl} target="_blank" rel="noopener noreferrer"
           className="text-blue-300 hover:underline text-[11px]"
           title={`Open Ohio Secretary of State business registry (search manually for "${lessorName}" — the SoS UI is JS-rendered so deep-links don't work)`}>
          OH SoS ↗
        </a>
      )}
    </span>
  );
}

function ExposureCell({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded p-3">
      <div className="text-gray-500 uppercase tracking-wider" style={{ fontSize: '10px' }}>{label}</div>
      <div className="font-mono font-semibold mt-1 text-lg" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Wellspan timeline ───────────────────────────────────────────────────────
//
// Compact horizontal ribbon showing the well's lifetime from permit to plug
// (or "today" if not plugged), proportional to elapsed time. Built from the
// existing scalar dates on the wells row — no production-history table needed.
//
// Milestones:
//   ● Permit issued     (well.permit_issued)
//   ● Completion        (well.completion_date) — IP volumes shown here
//   ● Last production   (well.last_nonzero_production_year + last_production_quarter)
//   ● Plugged           (well.plug_date)  OR  current "Now" marker if not plugged
//
// Segments between milestones convey state:
//   permit → completion : drilling phase, gray dashed
//   completion → last   : active production, green
//   last   → plug/now   : inactive, amber (red gradient near today if unplugged)

function WellspanTimeline({ well }: { well: WellRow }) {
  const today = new Date();

  // Ohio's last_production_quarter is "<n>/<yyyy>" where n is 0..4
  // (0 = annual rollup / unknown). Take only the leading digit; everything
  // else (NaN, 0, out-of-range) falls through to January so the year still
  // anchors the timeline. Without the early bound, `parseInt("02025") = 2025`
  // would overflow `new Date(year, month, 1)` by ~500 years.
  function quarterToMonth(q: string | null): number {
    if (!q) return 0;
    const m = q.match(/^\s*(\d)/);
    const n = m ? parseInt(m[1], 10) : 0;
    if (n < 1 || n > 4) return 0;
    return (n - 1) * 3;
  }

  const permitDate = well.permit_issued      ? new Date(well.permit_issued)     : null;
  const compDate   = well.completion_date    ? new Date(well.completion_date)   : null;
  const lastProdDate = well.last_nonzero_production_year != null
    ? new Date(well.last_nonzero_production_year, quarterToMonth(well.last_production_quarter), 1)
    : null;
  const plugDate   = well.plug_date          ? new Date(well.plug_date)         : null;

  // Anchor span: earliest known event → plug date OR today.
  const knownDates = [permitDate, compDate, lastProdDate, plugDate].filter((d): d is Date => d !== null);
  if (knownDates.length === 0) {
    return <div className="text-[11px] text-gray-500">No timeline data on record.</div>;
  }
  const start = new Date(Math.min(...knownDates.map(d => d.getTime())));
  const endActual = plugDate ?? today;
  // Pad end by ~5% so the rightmost marker isn't flush against the edge.
  const totalMs = Math.max(endActual.getTime() - start.getTime(), 1);

  function pos(d: Date | null): number | null {
    if (!d) return null;
    const v = ((d.getTime() - start.getTime()) / totalMs) * 100;
    return Math.min(Math.max(v, 0), 100);
  }
  const pPermit = pos(permitDate);
  const pComp   = pos(compDate);
  const pLast   = pos(lastProdDate);
  const pPlug   = pos(plugDate);
  const pNow    = pos(today);

  function fmt(d: Date | null): string {
    if (!d) return '—';
    return d.getFullYear().toString();
  }

  function yearsBetween(a: Date | null, b: Date | null): string {
    if (!a || !b) return '—';
    const yrs = (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (yrs < 0) return '—';
    if (yrs < 1) return '<1 yr';
    return `${yrs.toFixed(0)} yr`;
  }

  // Segment definitions: (start_pct, end_pct, color, opacity)
  const segments: { from: number; to: number; color: string; opacity: number; dashed?: boolean }[] = [];
  if (pPermit != null && pComp != null) {
    segments.push({ from: pPermit, to: pComp, color: '#6b7280', opacity: 0.6, dashed: true }); // drilling
  }
  if (pComp != null && pLast != null) {
    segments.push({ from: pComp, to: pLast, color: '#4ade80', opacity: 0.8 }); // active
  }
  if (pLast != null) {
    const segEnd = pPlug ?? pNow ?? 100;
    if (segEnd > pLast) {
      segments.push({ from: pLast, to: segEnd, color: '#fbbf24', opacity: 0.7 }); // inactive
    }
  } else if (pComp != null) {
    // Completed but never reported any production: idle from completion forward.
    const segEnd = pPlug ?? pNow ?? 100;
    if (segEnd > pComp) {
      segments.push({ from: pComp, to: segEnd, color: '#94a3b8', opacity: 0.4 });
    }
  }

  return (
    <div>
      {/* Ribbon */}
      <div className="relative h-7 bg-gray-950 rounded">
        {segments.map((s, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 h-2 rounded"
            style={{
              left: `${s.from}%`,
              width: `${Math.max(s.to - s.from, 0.3)}%`,
              background: s.color,
              opacity: s.opacity,
              borderTop:    s.dashed ? `2px dashed ${s.color}` : undefined,
              borderBottom: s.dashed ? `2px dashed ${s.color}` : undefined,
              backgroundClip: s.dashed ? 'content-box' : undefined,
              backgroundColor: s.dashed ? 'transparent' : s.color,
            }}
          />
        ))}
        {/* Markers */}
        {pPermit != null && <Marker pos={pPermit} color="#9ca3af" title="Permit issued" />}
        {pComp   != null && <Marker pos={pComp}   color="#60a5fa" title="Completion" />}
        {pLast   != null && <Marker pos={pLast}   color="#4ade80" title="Last reported production" />}
        {pPlug   != null
          ? <Marker pos={pPlug} color="#22c55e" title="Plugged" filled />
          : pNow != null && <Marker pos={pNow} color="#ef4444" title="Today (unplugged)" />}
      </div>

      {/* Year labels under the ribbon */}
      <div className="relative h-4 text-[10px] text-gray-500 mt-1">
        {pPermit != null && <YearLabel pos={pPermit} text={fmt(permitDate)} />}
        {pComp   != null && <YearLabel pos={pComp}   text={fmt(compDate)} />}
        {pLast   != null && <YearLabel pos={pLast}   text={fmt(lastProdDate)} />}
        {pPlug   != null && <YearLabel pos={pPlug}   text={fmt(plugDate)} />}
      </div>

      {/* Summary line: phase durations + IP volumes at completion */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        <Phase label="Drilling"
               value={yearsBetween(permitDate, compDate)}
               color="#9ca3af" />
        <Phase label="Active"
               value={yearsBetween(compDate, lastProdDate)}
               color="#4ade80"
               sub={(well.ip_oil != null || well.ip_gas != null) ? (
                 <>
                   IP {well.ip_oil != null && <>{well.ip_oil.toLocaleString()} bbl</>}
                   {well.ip_oil != null && well.ip_gas != null && ' · '}
                   {well.ip_gas != null && <>{well.ip_gas.toLocaleString()} mcf</>}
                 </>
               ) : undefined} />
        <Phase label="Inactive"
               value={yearsBetween(lastProdDate, plugDate ?? today)}
               color="#fbbf24" />
        <Phase label="State"
               value={plugDate ? 'Plugged' : 'Not plugged'}
               color={plugDate ? '#22c55e' : '#ef4444'} />
      </div>
    </div>
  );
}

function Marker({ pos, color, title, filled }: { pos: number; color: string; title: string; filled?: boolean }) {
  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2"
      style={{
        left: `${pos}%`,
        borderColor: color,
        background: filled ? color : '#0a0a0a',
      }}
      title={title}
    />
  );
}

function YearLabel({ pos, text }: { pos: number; text: string }) {
  // Anchor labels by their natural position; CSS transform keeps them centered
  // on the marker. Edge clamping prevents overflow at 0% / 100%.
  const left = pos < 6 ? '0%' : pos > 94 ? '100%' : `${pos}%`;
  const transform = pos < 6 ? 'translateX(0)' : pos > 94 ? 'translateX(-100%)' : 'translateX(-50%)';
  return (
    <span className="absolute font-mono" style={{ left, transform }}>{text}</span>
  );
}

function Phase({ label, value, color, sub }: {
  label: string; value: string; color: string; sub?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded px-3 py-2">
      <div className="text-gray-500 uppercase tracking-wider" style={{ fontSize: '9px' }}>{label}</div>
      <div className="font-mono font-semibold mt-0.5" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
