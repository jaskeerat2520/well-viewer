'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { Priority, PRIORITY_COLOR } from '@/lib/types';

const PAGE_SIZE = 100;
const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

// 32 ARC (Appalachian Regional Commission) Ohio counties — stored ALL CAPS in DB
const ARC_COUNTIES = [
  'ADAMS','ASHTABULA','ATHENS','BELMONT','BROWN','CARROLL','CLERMONT',
  'COLUMBIANA','COSHOCTON','GALLIA','GUERNSEY','HARRISON','HIGHLAND',
  'HOCKING','HOLMES','JACKSON','JEFFERSON','KNOX','LAWRENCE','LICKING',
  'MEIGS','MONROE','MORGAN','MUSKINGUM','NOBLE','PERRY','PIKE','ROSS',
  'SCIOTO','TUSCARAWAS','VINTON','WASHINGTON',
];

const OPERATOR_STATUS_LABEL: Record<string, string> = {
  orphan_program:  'Orphan Program',
  historic_owner:  'Historic Owner',
  named_operator:  'Named Operator',
  unknown:         'Unknown',
};
const OPERATOR_STATUS_COLOR: Record<string, string> = {
  orphan_program: '#ef4444',
  historic_owner: '#f97316',
  named_operator: '#22c55e',
  unknown:        '#6b7280',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface WellTableRow {
  api_no: string;
  well_name: string | null;
  county: string | null;
  township: string | null;
  status: string | null;
  operator: string | null;
  well_type: string | null;
  in_orphan_program: boolean | null;
  total_depth: number | null;
  permit_issued: string | null;
  completion_date: string | null;
  last_nonzero_production_year: number | null;
  last_active_year: number | null;
  last_active_source: 'prod' | 'compl' | null;
  priority: Priority | null;
  risk_score: number | null;
  water_risk_score: number | null;
  population_risk_score: number | null;
  inactivity_score: number | null;
  nearest_water_distance_m: number | null;
  within_protection_zone: boolean | null;
  operator_status: string | null;
  population_within_1km: number | null;
  population_within_5km: number | null;
  years_inactive: number | null;
  lat: number | null;
  lng: number | null;
}

type SortCol = keyof WellTableRow;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TablePage() {
  const [rows, setRows]       = useState<WellTableRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch]                         = useState('');
  const [debouncedSearch, setDebouncedSearch]       = useState('');
  const [countyFilter, setCountyFilter]             = useState('');
  const [priorityFilter, setPriorityFilter]         = useState<Priority[]>([]);
  const [statusFilter, setStatusFilter]             = useState('');
  const [operatorStatusFilter, setOperatorStatusFilter] = useState('');
  const [appalachianOnly, setAppalachianOnly]       = useState(false);

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>('risk_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Dropdown option lists
  const [counties, setCounties] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);

  // Debounce search input
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function handleSearchChange(val: string) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(0);
    }, 350);
  }

  // Fetch county + status lists once on mount
  useEffect(() => {
    supabase
      .from('county_summary')
      .select('county')
      .not('county', 'is', null)
      .order('county')
      .then(({ data }) => {
        if (data) setCounties(data.map(r => r.county as string));
      });

    supabase
      .from('wells')
      .select('status')
      .not('status', 'is', null)
      .then(({ data }) => {
        if (data) {
          const unique = [...new Set(data.map(r => r.status as string))].sort();
          setStatuses(unique);
        }
      });
  }, []);

  // Fetch paginated/filtered/sorted data
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);

      let query = supabase
        .from('well_table_view')
        .select(
          'api_no,well_name,county,township,status,operator,well_type,' +
          'in_orphan_program,total_depth,permit_issued,completion_date,' +
          'last_nonzero_production_year,last_active_year,last_active_source,' +
          'priority,risk_score,water_risk_score,' +
          'population_risk_score,inactivity_score,nearest_water_distance_m,' +
          'within_protection_zone,operator_status,population_within_1km,' +
          'population_within_5km,years_inactive',
          { count: 'exact' }
        );

      if (debouncedSearch) {
        query = query.or(
          `well_name.ilike.%${debouncedSearch}%,api_no.ilike.%${debouncedSearch}%`
        );
      }
      if (countyFilter)          query = query.eq('county', countyFilter);
      else if (appalachianOnly)  query = query.in('county', ARC_COUNTIES);
      if (priorityFilter.length) query = query.in('priority', priorityFilter);
      if (statusFilter)          query = query.eq('status', statusFilter);
      if (operatorStatusFilter)  query = query.eq('operator_status', operatorStatusFilter);

      query = query.order(sortCol, { ascending: sortDir === 'asc', nullsFirst: false });
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (cancelled) return;
      if (!error && data) {
        setRows(data as unknown as WellTableRow[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    }
    fetchData();
    return () => { cancelled = true; };
  }, [debouncedSearch, countyFilter, appalachianOnly, priorityFilter, statusFilter,
      operatorStatusFilter, sortCol, sortDir, page]);

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
    setPage(0);
  }

  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setCountyFilter('');
    setAppalachianOnly(false);
    setPriorityFilter([]);
    setStatusFilter('');
    setOperatorStatusFilter('');
    setPage(0);
  }

  const hasFilters = !!(search || countyFilter || appalachianOnly || priorityFilter.length || statusFilter || operatorStatusFilter);

  // ── Excel export ────────────────────────────────────────────────────────────
  const [exportLoading, setExportLoading] = useState(false);

  async function handleExport() {
    setExportLoading(true);
    try {
      // Fetch all matching rows in 1000-row batches
      const allRows: WellTableRow[] = [];
      let from = 0;
      const BATCH = 1000;

      while (true) {
        let q = supabase
          .from('well_table_view')
          .select(
            'api_no,well_name,county,township,status,operator,well_type,' +
            'in_orphan_program,total_depth,permit_issued,completion_date,' +
            'last_nonzero_production_year,last_active_year,last_active_source,' +
            'priority,risk_score,water_risk_score,population_risk_score,' +
            'inactivity_score,nearest_water_distance_m,within_protection_zone,' +
            'operator_status,population_within_1km,population_within_5km,' +
            'years_inactive,lat,lng'
          );

        if (debouncedSearch) q = q.or(`well_name.ilike.%${debouncedSearch}%,api_no.ilike.%${debouncedSearch}%`);
        if (countyFilter)         q = q.eq('county', countyFilter);
        else if (appalachianOnly) q = q.in('county', ARC_COUNTIES);
        if (priorityFilter.length) q = q.in('priority', priorityFilter);
        if (statusFilter)          q = q.eq('status', statusFilter);
        if (operatorStatusFilter)  q = q.eq('operator_status', operatorStatusFilter);

        q = q.order(sortCol, { ascending: sortDir === 'asc', nullsFirst: false });
        q = q.range(from, from + BATCH - 1);

        const { data, error } = await q;
        if (error || !data || data.length === 0) break;
        allRows.push(...(data as unknown as WellTableRow[]));
        if (data.length < BATCH) break;
        from += BATCH;
      }

      // ── Sheet 1: Wells ───────────────────────────────────────────────────
      const wellsData = allRows.map(r => ({
        'API Number':            r.api_no,
        'Well Name':             r.well_name ?? '',
        'County':                r.county ? titleCase(r.county) : '',
        'Township':              r.township ?? '',
        'Status':                r.status ?? '',
        'Operator Status':       r.operator_status ?? '',
        'Operator':              r.operator ?? '',
        'In Orphan Program':     r.in_orphan_program ? 'Yes' : 'No',
        'Priority':              r.priority ?? '',
        'Risk Score':            r.risk_score ?? '',
        'Water Risk':            r.water_risk_score ?? '',
        'Population Risk':       r.population_risk_score ?? '',
        'Inactivity Score':      r.inactivity_score ?? '',
        'Years Inactive':        r.years_inactive ?? '',
        'Last Active Year':      r.last_active_year ?? '',
        'Last Active Source':    r.last_active_source === 'compl' ? 'Completion date' : r.last_active_source === 'prod' ? 'Production record' : '',
        'Water Dist (km)':       r.nearest_water_distance_m != null ? +(r.nearest_water_distance_m / 1000).toFixed(2) : '',
        'In Protection Zone':    r.within_protection_zone ? 'Yes' : 'No',
        'Population 1km':        r.population_within_1km ?? '',
        'Population 5km':        r.population_within_5km ?? '',
        'Well Type':             r.well_type ?? '',
        'Completion Date':       r.completion_date?.slice(0, 10) ?? '',
        'Permit Issued':         r.permit_issued?.slice(0, 10) ?? '',
        'Depth (ft)':            r.total_depth ?? '',
        'Latitude':              r.lat ?? '',
        'Longitude':             r.lng ?? '',
      }));

      const wsWells = XLSX.utils.json_to_sheet(wellsData);
      wsWells['!cols'] = [
        { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 28 },
        { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
        { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
        { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
      ];
      wsWells['!freeze'] = { xSplit: 0, ySplit: 1 };

      // ── Sheet 2: County Summary ──────────────────────────────────────────
      const { data: countyData } = await supabase
        .from('county_status_summary')
        .select('*')
        .order('county');

      const countyRows = (countyData ?? []).map((r: Record<string, unknown>) => ({
        'County':           r.county,
        'CTY #':            r.cty_num,
        'Total Records':    r.total_records,
        'To Plug':          r.potential_to_plug,
        '% to Plug':        r.total_records ? +((+(r.potential_to_plug as number) / +(r.total_records as number)) * 100).toFixed(1) : 0,
        'Active Wells':     r.active_wells,
        'Historic Owner':   r.historic_owner,
        'Producing':        r.producing,
        'Injection':        r.injection,
        'Storage':          r.storage,
        'Orphan':           r.orphan,
        'Drilling':         r.drilling,
        'Permitted':        r.permitted,
        'FI WNF':           r.fi_wnf,
        'FR':               r.fr,
        'Exp':              r.exp,
        'P&A':              r.pa,
        'Unknown':          r.unk,
        'Drilled':          r.drilled,
        'Appalachian':      ARC_COUNTIES.includes(r.county as string) ? 'Yes' : 'No',
      }));

      const wsCounty = XLSX.utils.json_to_sheet(countyRows);
      wsCounty['!cols'] = Array(20).fill({ wch: 14 });
      wsCounty['!cols'][0] = { wch: 18 };
      wsCounty['!freeze'] = { xSplit: 0, ySplit: 1 };

      // ── Build workbook & download ────────────────────────────────────────
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsWells,   'Wells');
      XLSX.utils.book_append_sheet(wb, wsCounty,  'County Summary');

      const filterLabel = [
        appalachianOnly ? 'appalachian' : '',
        countyFilter    ? countyFilter.toLowerCase() : '',
        priorityFilter.length ? priorityFilter.join('-') : '',
        statusFilter    ? statusFilter.toLowerCase().replace(/\s+/g, '_') : '',
      ].filter(Boolean).join('_');

      const filename = `ohio_wells${filterLabel ? '_' + filterLabel : ''}_${new Date().toISOString().slice(0,10)}.xlsx`;
      XLSX.writeFile(wb, filename);

    } finally {
      setExportLoading(false);
    }
  }

  // When Appalachian toggle is on, only show ARC counties in the dropdown
  const visibleCounties = appalachianOnly
    ? counties.filter(c => ARC_COUNTIES.includes(c))
    : counties;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startRow   = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const endRow     = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-tight">Ohio Well Data — Table</h1>
          <span className="text-xs text-gray-500">
            {loading
              ? 'Loading…'
              : total > 0
                ? `${startRow.toLocaleString()}–${endRow.toLocaleString()} of ${total.toLocaleString()} wells`
                : 'No results'}
          </span>
        </div>
        <nav className="flex items-center gap-4">
          <button
            onClick={handleExport}
            disabled={exportLoading || loading}
            className="text-xs px-3 py-1 rounded border border-green-600 text-green-400 hover:bg-green-600 hover:text-black transition-colors disabled:opacity-40"
          >
            {exportLoading ? 'Preparing…' : '↓ Excel'}
          </button>
          <Link href="/about"    className="text-xs text-gray-400 hover:text-white transition-colors">About</Link>
          <Link href="/"         className="text-xs text-gray-400 hover:text-white transition-colors">← Map</Link>
          <Link href="/counties" className="text-xs text-gray-400 hover:text-white transition-colors">Counties</Link>
          <Link href="/facts"    className="text-xs text-gray-400 hover:text-white transition-colors">Facts</Link>
          <Link href="/impact"   className="text-xs text-gray-400 hover:text-white transition-colors">Impact</Link>
          <Link href="/emissions" className="text-xs text-gray-400 hover:text-white transition-colors">Emissions →</Link>
        </nav>
      </header>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0 flex-wrap">

        {/* Search */}
        <input
          type="text"
          placeholder="Search well name or API…"
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-gray-400 w-52"
        />

        {/* Appalachian toggle */}
        <button
          onClick={() => { setAppalachianOnly(v => !v); setCountyFilter(''); setPage(0); }}
          className="px-2 py-1 rounded text-xs font-medium border transition-colors"
          style={{
            borderColor:     '#a78bfa',
            color:           appalachianOnly ? '#000' : '#a78bfa',
            backgroundColor: appalachianOnly ? '#a78bfa' : 'transparent',
          }}
        >
          Appalachian
        </button>

        {/* County */}
        <select
          value={countyFilter}
          onChange={e => { setCountyFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
        >
          <option value="">{appalachianOnly ? 'All ARC counties' : 'All counties'}</option>
          {visibleCounties.map(c => (
            <option key={c} value={c}>
              {c.charAt(0) + c.slice(1).toLowerCase()}
            </option>
          ))}
        </select>

        {/* Priority pills */}
        <div className="flex items-center gap-1">
          {PRIORITIES.map(p => {
            const active = priorityFilter.includes(p);
            const faded  = priorityFilter.length > 0 && !active;
            return (
              <button
                key={p}
                onClick={() => {
                  setPriorityFilter(prev =>
                    prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                  );
                  setPage(0);
                }}
                className="px-2 py-0.5 rounded text-xs font-medium border transition-opacity capitalize"
                style={{
                  borderColor:     PRIORITY_COLOR[p],
                  color:           active ? '#000' : PRIORITY_COLOR[p],
                  backgroundColor: active ? PRIORITY_COLOR[p] : 'transparent',
                  opacity:         faded ? 0.35 : 1,
                }}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Status */}
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400 max-w-44"
        >
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Operator status */}
        <select
          value={operatorStatusFilter}
          onChange={e => { setOperatorStatusFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
        >
          <option value="">All operator statuses</option>
          <option value="orphan_program">Orphan Program</option>
          <option value="historic_owner">Historic Owner</option>
          <option value="named_operator">Named Operator</option>
          <option value="unknown">Unknown</option>
        </select>

        {/* Clear */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-1 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="text-xs w-full border-collapse min-w-max">
          <thead className="sticky top-0 z-10 bg-gray-800">
            <tr>
              <Col label="Priority"     col="priority"                    sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Risk"         col="risk_score"                  sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="API No"       col="api_no"                      sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Well Name"    col="well_name"                   sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="County"       col="county"                      sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Township"     col="township"                    sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Status"       col="status"                      sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Oper. Status" col="operator_status"             sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Operator"     col="operator"                    sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Orphan"       col="in_orphan_program"           sort={sortCol} dir={sortDir} onSort={handleSort} center />
              <Col label="Yrs Inactive" col="years_inactive"              sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Last Active"  col="last_active_year"            sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Water Dist"   col="nearest_water_distance_m"   sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="In Zone"      col="within_protection_zone"      sort={sortCol} dir={sortDir} onSort={handleSort} center />
              <Col label="Water Risk"   col="water_risk_score"            sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Pop Risk"     col="population_risk_score"       sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Inactivity"   col="inactivity_score"            sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Pop 1km"      col="population_within_1km"       sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Pop 5km"      col="population_within_5km"       sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Type"         col="well_type"                   sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Completion"   col="completion_date"             sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Permit"       col="permit_issued"               sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Depth (ft)"   col="total_depth"                 sort={sortCol} dir={sortDir} onSort={handleSort} right />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={23} className="text-center py-10 text-gray-500">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={23} className="text-center py-10 text-gray-500">No wells match these filters.</td>
              </tr>
            ) : rows.map((row, i) => (
              <DataRow key={row.api_no} row={row} stripe={i % 2 === 1} />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-t border-gray-700 shrink-0">
          <button
            disabled={page === 0 || loading}
            onClick={() => setPage(p => p - 1)}
            className="text-xs px-3 py-1 rounded border border-gray-600 disabled:opacity-30 hover:border-gray-400 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-400">
            Page {(page + 1).toLocaleString()} of {totalPages.toLocaleString()}
          </span>
          <button
            disabled={page >= totalPages - 1 || loading}
            onClick={() => setPage(p => p + 1)}
            className="text-xs px-3 py-1 rounded border border-gray-600 disabled:opacity-30 hover:border-gray-400 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Column header ─────────────────────────────────────────────────────────────

function Col({
  label, col, sort, dir, onSort, right, center,
}: {
  label: string;
  col: SortCol;
  sort: SortCol;
  dir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
  right?: boolean;
  center?: boolean;
}) {
  const active = sort === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`
        px-2 py-2 font-medium text-gray-400 uppercase tracking-wider
        whitespace-nowrap cursor-pointer hover:text-white select-none
        border-b border-gray-700
        ${right ? 'text-right' : center ? 'text-center' : 'text-left'}
      `}
      style={{ fontSize: '10px' }}
    >
      {label}{active ? (dir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  );
}

// ── Data row ──────────────────────────────────────────────────────────────────

function DataRow({ row, stripe }: { row: WellTableRow; stripe: boolean }) {
  return (
    <tr className={`${stripe ? 'bg-gray-900/40' : ''} hover:bg-gray-800/60 transition-colors`}>

      {/* Priority */}
      <td className="px-2 py-1 whitespace-nowrap">
        {row.priority
          ? <span
              className="px-1.5 py-0.5 rounded font-bold uppercase"
              style={{ backgroundColor: PRIORITY_COLOR[row.priority], color: '#000', fontSize: '10px' }}
            >{row.priority}</span>
          : <Dash />}
      </td>

      {/* Risk score */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap">
        {row.risk_score != null
          ? <span style={{ color: riskColor(row.risk_score) }}>{row.risk_score.toFixed(1)}</span>
          : <Dash />}
      </td>

      {/* API No */}
      <td className="px-2 py-1 font-mono text-gray-400 whitespace-nowrap">{row.api_no}</td>

      {/* Well Name */}
      <td className="px-2 py-1 max-w-44 truncate" title={row.well_name ?? ''}>
        {row.well_name ?? <Dash />}
      </td>

      {/* County */}
      <td className="px-2 py-1 whitespace-nowrap">
        {row.county ? titleCase(row.county) : <Dash />}
      </td>

      {/* Township */}
      <td className="px-2 py-1 whitespace-nowrap text-gray-300">
        {row.township ?? <Dash />}
      </td>

      {/* Status */}
      <td className="px-2 py-1 whitespace-nowrap text-gray-300">
        {row.status ?? <Dash />}
      </td>

      {/* Operator status */}
      <td className="px-2 py-1 whitespace-nowrap">
        {row.operator_status
          ? <span style={{ color: OPERATOR_STATUS_COLOR[row.operator_status] ?? '#fff' }}>
              {OPERATOR_STATUS_LABEL[row.operator_status] ?? row.operator_status}
            </span>
          : <Dash />}
      </td>

      {/* Operator */}
      <td className="px-2 py-1 max-w-40 truncate text-gray-300" title={row.operator ?? ''}>
        {row.operator ?? <Dash />}
      </td>

      {/* Orphan program */}
      <td className="px-2 py-1 text-center">
        {row.in_orphan_program
          ? <span className="text-orange-400 font-bold">✓</span>
          : <span className="text-gray-700">—</span>}
      </td>

      {/* Years inactive */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap">
        {row.years_inactive != null ? row.years_inactive : <Dash />}
      </td>

      {/* Last active year (prod year or completion year fallback) */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap">
        {row.last_active_year != null ? (
          <span>
            {row.last_active_year}
            {row.last_active_source === 'compl' && (
              <span className="text-gray-500 ml-1" title="Based on completion date, no production record">c</span>
            )}
          </span>
        ) : <Dash />}
      </td>

      {/* Water distance */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap">
        {row.nearest_water_distance_m != null
          ? `${(row.nearest_water_distance_m / 1000).toFixed(1)} km`
          : <Dash />}
      </td>

      {/* In protection zone */}
      <td className="px-2 py-1 text-center">
        {row.within_protection_zone === true
          ? <span className="text-red-400 font-bold">✓</span>
          : <span className="text-gray-700">—</span>}
      </td>

      {/* Water risk */}
      <td className="px-2 py-1 font-mono text-right">
        {row.water_risk_score != null ? row.water_risk_score : <Dash />}
      </td>

      {/* Pop risk */}
      <td className="px-2 py-1 font-mono text-right">
        {row.population_risk_score != null ? row.population_risk_score : <Dash />}
      </td>

      {/* Inactivity score */}
      <td className="px-2 py-1 font-mono text-right">
        {row.inactivity_score != null ? row.inactivity_score : <Dash />}
      </td>

      {/* Pop 1km */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap">
        {row.population_within_1km != null ? row.population_within_1km.toLocaleString() : <Dash />}
      </td>

      {/* Pop 5km */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap">
        {row.population_within_5km != null ? row.population_within_5km.toLocaleString() : <Dash />}
      </td>

      {/* Well type */}
      <td className="px-2 py-1 whitespace-nowrap text-gray-300">
        {row.well_type ?? <Dash />}
      </td>

      {/* Completion date */}
      <td className="px-2 py-1 whitespace-nowrap font-mono text-gray-300">
        {row.completion_date?.slice(0, 10) ?? <Dash />}
      </td>

      {/* Permit issued */}
      <td className="px-2 py-1 whitespace-nowrap font-mono text-gray-300">
        {row.permit_issued?.slice(0, 10) ?? <Dash />}
      </td>

      {/* Total depth */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap text-gray-300">
        {row.total_depth != null ? row.total_depth.toLocaleString() : <Dash />}
      </td>
    </tr>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Dash() {
  return <span className="text-gray-700">—</span>;
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function riskColor(score: number) {
  if (score >= 75) return '#ef4444';
  if (score >= 55) return '#f97316';
  if (score >= 35) return '#eab308';
  return '#22c55e';
}
