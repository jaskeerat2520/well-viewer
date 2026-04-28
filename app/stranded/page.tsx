'use client';

// Stranded mineral-rights wells: defunct corporate lessor + no recent
// production + unplugged. ~310 wells statewide. Backed by the public.stranded_wells
// SQL view. NOT a scoring artifact (per the user's no-landowner-scoring decision)
// — a policy / narrative artifact for stakeholder framing.
//
// See memory: project_stranded_mineral_rights_wells.md

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import SiteHeader from '@/components/SiteHeader';

interface StrandedRow {
  api_no: string;
  well_name: string | null;
  county: string | null;
  status: string | null;
  operator: string | null;
  lease_name: string | null;
  completion_date: string | null;
  completion_year: number | null;
  last_nonzero_production_year: number | null;
  composite_risk_score: number | null;
  priority: string | null;
  historical_mineral_lessor: string | null;
  surface_owner_name: string | null;
  surface_owner_mailing_state: string | null;
  successor_status: string | null;
  successor_entity: string | null;
  successor_ticker: string | null;
  successor_source_url:  string | null;
  successor_verification: string | null;
}

// Color coding the successor column. Living-successor entries are the
// surprising / actionable subset — they flip a well from "no responsible
// party" to "current corporate liability path exists."
const SUCCESSOR_COLOR: Record<string, string> = {
  living_successor:       '#22c55e',  // green — actionable corporate liability
  partial_successor:      '#84cc16',  // lime  — multiple successors, usable
  dissolved_no_successor: '#ef4444',  // red   — truly orphan-of-orphan
  individual_lessor:      '#a855f7',  // purple — natural-person, probate path
  unclear:                '#6b7280',  // gray  — needs research
};
const SUCCESSOR_LABEL: Record<string, string> = {
  living_successor:       'Living successor',
  partial_successor:      'Partial successor',
  dissolved_no_successor: 'Truly dissolved',
  individual_lessor:      'Individual lessor',
  unclear:                'Unclear',
};

// Evidence pill — describes ONLY whether the named successor company is real
// and traceable. It does NOT claim that the company has inherited statutory
// plugging duty for the well; under ORC 1509 the operator (not the lessor) is
// the primary liable party. See the page-level evidence-caveat block below the
// table and the per-pill tooltip for the full disclaimer.
//
//   verified    — researched + source link + active ticker (publicly traded)
//   researched  — researched but missing ticker or source link
//   unverified  — no research basis (pattern-matched on lessor name only)
type EvidenceLevel = 'verified' | 'researched' | 'unverified';
const EVIDENCE_COLOR: Record<EvidenceLevel, string> = {
  verified:   '#22c55e',
  researched: '#eab308',
  unverified: '#9ca3af',
};

function evidenceLevel(
  verification: string | null,
  sourceUrl: string | null,
  ticker: string | null,
): EvidenceLevel {
  const researched = verification === 'web_research' || verification === 'oh_sos_verified';
  if (researched && sourceUrl && ticker) return 'verified';
  if (!verification || verification === 'unverified') return 'unverified';
  if (verification === 'pattern_classified' && !sourceUrl) return 'unverified';
  return 'researched';
}

// Hostname extraction for inline source labels. WHATWG URL throws on
// malformed input — fall back to a generic label rather than crashing the row.
function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function priorityColor(p: string | null): string {
  if (p === 'critical') return '#ef4444';
  if (p === 'high')     return '#f97316';
  if (p === 'medium')   return '#eab308';
  return '#6b7280';
}

function titleCase(s: string | null): string {
  if (!s) return '';
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

type SortKey = 'lessor' | 'county' | 'completion_year' | 'last_prod' | 'composite' | 'successor';

export default function StrandedWellsPage() {
  const [rows,    setRows]    = useState<StrandedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lessorFilter,    setLessorFilter]    = useState<string>('');
  const [countyFilter,    setCountyFilter]    = useState<string>('');
  const [successorFilter, setSuccessorFilter] = useState<string>('');
  const [sortKey,         setSortKey]         = useState<SortKey>('lessor');
  const [sortDesc,        setSortDesc]        = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      // The view already applies all the filters (defunct lessor pattern, no
      // recent prod, unplugged). We just sort it client-side.
      const { data, error } = await supabase
        .from('stranded_wells')
        .select('*')
        .limit(2000);
      if (cancelled) return;
      if (error) {
        console.error('Failed to load stranded_wells:', error);
        setRows([]);
      } else {
        setRows((data ?? []) as StrandedRow[]);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Distinct values for filter dropdowns. Memoized so they don't recompute on
  // every keystroke.
  const lessors = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => {
      if (!r.historical_mineral_lessor) return;
      m.set(r.historical_mineral_lessor, (m.get(r.historical_mineral_lessor) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const counties = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => {
      if (!r.county) return;
      m.set(r.county, (m.get(r.county) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (lessorFilter    && r.historical_mineral_lessor !== lessorFilter)    return false;
      if (countyFilter    && r.county                    !== countyFilter)    return false;
      if (successorFilter && r.successor_status          !== successorFilter) return false;
      return true;
    });
  }, [rows, lessorFilter, countyFilter, successorFilter]);

  // Counts per successor status for the dropdown labels.
  const successorCounts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => {
      if (!r.successor_status) return;
      m.set(r.successor_status, (m.get(r.successor_status) ?? 0) + 1);
    });
    return m;
  }, [rows]);

  const sorted = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    function cmp(a: StrandedRow, b: StrandedRow): number {
      switch (sortKey) {
        case 'lessor':           return ((a.historical_mineral_lessor ?? '').localeCompare(b.historical_mineral_lessor ?? ''))    * dir;
        case 'county':           return ((a.county ?? '').localeCompare(b.county ?? ''))                                          * dir;
        case 'completion_year':  return (((a.completion_year ?? 0) - (b.completion_year ?? 0)))                                   * dir;
        case 'last_prod':        return (((a.last_nonzero_production_year ?? 0) - (b.last_nonzero_production_year ?? 0)))         * dir;
        case 'composite':        return (((a.composite_risk_score ?? 0) - (b.composite_risk_score ?? 0)))                         * dir;
        case 'successor':        return ((a.successor_status ?? '').localeCompare(b.successor_status ?? ''))                      * dir;
      }
    }
    return [...filtered].sort(cmp);
  }, [filtered, sortKey, sortDesc]);

  function clickSort(k: SortKey) {
    if (k === sortKey) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(false); }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">
      <SiteHeader title="Stranded Mineral-Rights Wells" subtitle="Defunct corporate lessor · no recent production · unplugged" />

      {/* Context blurb */}
      <div className="px-6 py-4 border-b border-gray-800 text-xs text-gray-400 leading-relaxed max-w-3xl">
        These are <span className="text-white">orphan-of-orphan</span> wells: the historical
        mineral-rights lessor at time of permit was a corporate entity that appears defunct
        (coal companies, oil companies dating to the 1900s–1970s), no production has been
        reported since 2015, and the well is still unplugged. Mineral rights may be in legal
        limbo or have escheated under Ohio&apos;s{' '}
        <a href="https://codes.ohio.gov/ohio-revised-code/section-5301.56" target="_blank" rel="noopener noreferrer"
           className="text-blue-400 hover:underline">
          Dormant Mineral Act (R.C. 5301.56)
        </a>
        . The single largest defunct lessor on this list is <span className="text-white">Sunday Creek Coal Co</span>,
        bankrupt in the 1920s.
      </div>

      {/* Evidence interpretation — what the "company verified" pill does and does not claim */}
      <div className="px-6 py-3 border-b border-gray-800 text-[11px] text-gray-400 leading-relaxed max-w-3xl">
        <span className="text-amber-400 uppercase tracking-wider text-[10px] font-semibold">How to read the evidence pill: </span>
        The <span className="text-white">company verified / researched / unverified</span> pill describes only
        whether the named successor entity is a real, traceable company today
        (e.g., the ticker resolves to an active NYSE listing). It does
        <span className="text-white"> not</span> confirm that the company has
        inherited statutory plugging duty for the specific well. Under{' '}
        <a href="https://codes.ohio.gov/ohio-revised-code/section-1509.062" target="_blank" rel="noopener noreferrer"
           className="text-blue-400 hover:underline">
          ORC 1509
        </a>
        , the <span className="text-white">operator</span> (not the underlying mineral-rights lessor) is the
        primary party responsible for plugging. Lessor-successor liability for wells the lessor never
        operated is a secondary theory, not established by the source links in this table — those links
        are typically Wikipedia entries that establish corporate lineage at the brand level only.
      </div>

      {/* Headline counts + filter controls */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-6 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Wells shown</div>
          <div className="text-2xl font-semibold font-mono">{filtered.length.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Defunct lessors</div>
          <div className="text-2xl font-semibold font-mono">{lessors.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Counties</div>
          <div className="text-2xl font-semibold font-mono">{counties.length}</div>
        </div>
        <div className="flex-1" />
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Filter by lessor</label>
          <select value={lessorFilter} onChange={e => setLessorFilter(e.target.value)}
                  className="px-2 py-1 rounded text-xs bg-gray-800 text-white border border-gray-700 min-w-[16rem]">
            <option value="">All ({rows.length} wells)</option>
            {lessors.map(([name, n]) => (
              <option key={name} value={name}>{name} ({n})</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Filter by county</label>
          <select value={countyFilter} onChange={e => setCountyFilter(e.target.value)}
                  className="px-2 py-1 rounded text-xs bg-gray-800 text-white border border-gray-700 min-w-[10rem]">
            <option value="">All</option>
            {counties.map(([name, n]) => (
              <option key={name} value={name}>{titleCase(name)} ({n})</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-500">Filter by successor</label>
          <select value={successorFilter} onChange={e => setSuccessorFilter(e.target.value)}
                  className="px-2 py-1 rounded text-xs bg-gray-800 text-white border border-gray-700 min-w-[14rem]">
            <option value="">All</option>
            {(['living_successor', 'partial_successor', 'dissolved_no_successor', 'individual_lessor', 'unclear'] as const)
              .filter(s => (successorCounts.get(s) ?? 0) > 0)
              .map(s => (
                <option key={s} value={s}>
                  {SUCCESSOR_LABEL[s]} ({successorCounts.get(s) ?? 0})
                </option>
              ))}
          </select>
        </div>
      </div>

      {loading && <div className="px-6 py-10 text-gray-500 text-sm">Loading…</div>}

      {!loading && (
        <div className="px-6 py-4 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400 uppercase tracking-wider sticky top-0 bg-gray-950 z-10">
              <tr className="border-b border-gray-800">
                <th className="text-left px-2 py-2 font-medium">API</th>
                <th className="text-left px-2 py-2 font-medium">Well name</th>
                <Th onClick={() => clickSort('county')}          active={sortKey==='county'}          desc={sortDesc} align="left">County</Th>
                <Th onClick={() => clickSort('lessor')}          active={sortKey==='lessor'}          desc={sortDesc} align="left">Defunct lessor</Th>
                <Th onClick={() => clickSort('successor')}       active={sortKey==='successor'}       desc={sortDesc} align="left">Successor status</Th>
                <th className="text-left px-2 py-2 font-medium">Operator</th>
                <Th onClick={() => clickSort('completion_year')} active={sortKey==='completion_year'} desc={sortDesc} align="right">Completed</Th>
                <Th onClick={() => clickSort('last_prod')}       active={sortKey==='last_prod'}       desc={sortDesc} align="right">Last prod</Th>
                <Th onClick={() => clickSort('composite')}       active={sortKey==='composite'}       desc={sortDesc} align="right">Composite</Th>
                <th className="text-left px-2 py-2 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.api_no} className="border-b border-gray-900 hover:bg-gray-900">
                  <td className="px-2 py-1.5 font-mono text-gray-400">
                    <Link href={`/wells/${encodeURIComponent(r.api_no)}`} className="hover:text-white">
                      {r.api_no}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{r.well_name ?? '—'}</td>
                  <td className="px-2 py-1.5">{titleCase(r.county)}</td>
                  <td className="px-2 py-1.5 text-gray-300">{r.historical_mineral_lessor ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    {r.successor_status ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold inline-block w-fit"
                                style={{ background: SUCCESSOR_COLOR[r.successor_status] ?? '#6b7280', color: '#000' }}
                                title={SUCCESSOR_LABEL[r.successor_status] ?? r.successor_status}>
                            {SUCCESSOR_LABEL[r.successor_status] ?? r.successor_status}
                          </span>
                          {(r.successor_status === 'living_successor' || r.successor_status === 'partial_successor') && (() => {
                            const level = evidenceLevel(r.successor_verification, r.successor_source_url, r.successor_ticker);
                            const operatorPart = r.operator
                              ? `Operator ${r.operator} is the primary statutory liable party under ORC 1509.`
                              : 'The well operator (not the lessor) is the primary statutory liable party under ORC 1509.';
                            const tip =
                              `Pill scope: confirms the named successor company exists and is reachable. `
                              + `Does NOT confirm that this company has inherited plugging duty for this specific well. `
                              + operatorPart
                              + ` Signals: verification=${r.successor_verification ?? 'none'}, source=${r.successor_source_url ? 'yes' : 'no'}, ticker=${r.successor_ticker ?? 'no'}.`;
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold cursor-help"
                                    style={{ background: EVIDENCE_COLOR[level], color: '#000' }}
                                    title={tip}>
                                company {level}
                              </span>
                            );
                          })()}
                        </div>
                        {r.successor_entity && (
                          <span className="text-[11px] text-gray-300">
                            {r.successor_entity}
                            {r.successor_ticker && (
                              <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(r.successor_ticker)}`}
                                 target="_blank" rel="noopener noreferrer"
                                 className="ml-1 text-emerald-400 hover:underline font-mono"
                                 title={`Open ${r.successor_ticker} on Yahoo Finance — a working quote page is direct proof the company trades today`}>
                                ({r.successor_ticker} ↗)
                              </a>
                            )}
                          </span>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] flex-wrap">
                          <span className="text-gray-500">
                            {r.successor_verification === 'web_research'       && 'Researched'}
                            {r.successor_verification === 'pattern_classified' && 'Pattern-inferred'}
                            {r.successor_verification === 'oh_sos_verified'    && 'OH SoS verified'}
                            {(!r.successor_verification || r.successor_verification === 'unverified') && 'Unverified'}
                          </span>
                          {r.successor_source_url ? (
                            <a href={r.successor_source_url} target="_blank" rel="noopener noreferrer"
                               className="text-blue-300 hover:underline"
                               title={r.successor_source_url}>
                              Source: {sourceHost(r.successor_source_url) ?? 'link'} ↗
                            </a>
                          ) : (
                            r.successor_verification === 'web_research' && (
                              <span className="text-orange-400/80"
                                    title="This row was marked Researched but no source URL was captured. Treat the successor mapping as unverifiable until a source is added.">
                                Source: missing
                              </span>
                            )
                          )}
                          {r.historical_mineral_lessor && (
                            <>
                              <a href={`https://opencorporates.com/companies?q=${encodeURIComponent(r.historical_mineral_lessor)}`}
                                 target="_blank" rel="noopener noreferrer"
                                 className="text-blue-300 hover:underline"
                                 title="Search OpenCorporates (US + UK + 130 jurisdictions). Catches Delaware/Illinois-incorporated coal companies that may not appear in the OH SoS registry.">
                                OpenCorps ↗
                              </a>
                              <a href="https://businesssearch.ohiosos.gov/"
                                 target="_blank" rel="noopener noreferrer"
                                 className="text-blue-300 hover:underline"
                                 title={`Open Ohio Secretary of State business registry (search manually for "${r.historical_mineral_lessor}" — the SoS UI is JS-rendered so deep-links don't work).`}>
                                OH SoS ↗
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-gray-400">{r.operator ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{r.completion_year ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{r.last_nonzero_production_year ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {r.composite_risk_score != null ? r.composite_risk_score.toFixed(1) : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.priority ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold"
                            style={{ background: priorityColor(r.priority), color: '#000' }}>
                        {r.priority}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-gray-600 py-12">No wells match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children, onClick, active, desc, align,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  desc: boolean;
  align: 'left' | 'right';
}) {
  return (
    <th
      onClick={onClick}
      className={`px-2 py-2 font-medium cursor-pointer select-none hover:text-white text-${align}`}
    >
      {children}
      {active && <span className="ml-1 text-gray-500">{desc ? '↓' : '↑'}</span>}
    </th>
  );
}
