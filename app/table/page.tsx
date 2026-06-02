'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { getCached, setCached } from '@/lib/idbCache';
import { Priority, PRIORITY_COLOR, ADMIN_STATUS_LABEL, ADMIN_STATUS_COLOR, AdminStatus } from '@/lib/types';
import { formatDistanceUS, metersToMiles, metersToFeet, RADIUS_1KM, RADIUS_5KM } from '@/lib/units';
import SiteHeader from '@/components/SiteHeader';

const TABLE_VERSION = 5;   // bumped 2026-06-02 — Risk column now shows composite_risk_score (matches priority)
const STATUSES_VERSION = 2;
const TTL_24H = 24 * 60 * 60 * 1000;

const PAGE_SIZE = 100;
const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

type StateCode = 'OH' | 'PA' | 'WV';
const STATES: { code: StateCode; label: string }[] = [
  { code: 'OH', label: 'Ohio' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'WV', label: 'West Virginia' },
];

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
  composite_risk_score: number | null;
  water_risk_score: number | null;
  population_risk_score: number | null;
  inactivity_score: number | null;
  nearest_water_distance_m: number | null;
  within_protection_zone: boolean | null;
  operator_status: string | null;
  admin_status: string | null;
  population_within_1km: number | null;
  population_within_5km: number | null;
  years_inactive: number | null;
  lat: number | null;
  lng: number | null;
  state_code: StateCode | null;
  // ── ODNR hazard overlays (Tier 1 informational, OH-only). See migration 007. ──
  in_aum_subsidence_zone: boolean | null;
  in_state_floodplain:    boolean | null;
  in_dogrm_urban_area:    boolean | null;
  nearest_aum_opening_m:  number | null;
  // ── TRI facility proximity (Tier 1, OH-only). See migration 008. ──
  nearest_tri_distance_m:     number | null;
  nearest_tri_facility_name:  string | null;
  nearest_tri_parent_company: string | null;
}

type SortCol = keyof WellTableRow;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TablePage() {
  const [rows, setRows]       = useState<WellTableRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [stateFilter, setStateFilter]               = useState<StateCode>('OH');
  const [search, setSearch]                         = useState('');
  const [debouncedSearch, setDebouncedSearch]       = useState('');
  const [countyFilter, setCountyFilter]             = useState('');
  const [countyQuery, setCountyQuery]               = useState('');
  const [countyOpen, setCountyOpen]                 = useState(false);
  const [townshipFilter, setTownshipFilter]         = useState('');   // scoped to selected county
  const [townshipQuery, setTownshipQuery]           = useState('');
  const [townshipOpen, setTownshipOpen]             = useState(false);
  const [priorityFilter, setPriorityFilter]         = useState<Priority[]>([]);
  const [statusFilter, setStatusFilter]             = useState('');
  const [operatorStatusFilter, setOperatorStatusFilter] = useState('');
  const [adminStatusFilter, setAdminStatusFilter]       = useState('');
  const [lastProdFilter, setLastProdFilter]             = useState('');     // 'never' | 'before_2000' | '2000_2014' | '2015_2019' | '2020_plus'
  const [yearsInactiveFilter, setYearsInactiveFilter]   = useState('');     // 'under_5' | 'over_5' | 'over_20' | 'over_50'
  const [appalachianOnly, setAppalachianOnly]       = useState(false);

  // ── ODNR hazard filter chips (boolean toggles, OH-only). 2 booleans + 1 distance bucket. ──
  const [aumZoneOnly,      setAumZoneOnly]      = useState(false);
  const [dogrmUrbanOnly,   setDogrmUrbanOnly]   = useState(false);
  const [aumOpeningFilter, setAumOpeningFilter] = useState('');             // '' | 'under_500' | 'under_1km' | 'under_5km'

  // Sort
  const [sortCol, setSortCol] = useState<SortCol>('composite_risk_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Dropdown option lists
  const [counties, setCounties]   = useState<string[]>([]);
  const [townships, setTownships] = useState<string[]>([]);
  const [statuses, setStatuses]   = useState<string[]>([]);

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

  // Fetch county + status lists when state changes (cached per state).
  useEffect(() => {
    let cancelled = false;
    async function loadCounties() {
      const cacheKey = `table:counties_list:${stateFilter}`;
      const cached = await getCached<string[]>(cacheKey, STATUSES_VERSION, TTL_24H);
      if (cancelled) return;
      if (cached) { setCounties(cached); return; }
      // Ohio uses county_summary (richer, has scoring rollups). Other states pull
      // distinct counties from wells, since county_summary is Ohio-only.
      let list: string[] = [];
      if (stateFilter === 'OH') {
        const { data } = await supabase
          .from('county_summary')
          .select('county')
          .not('county', 'is', null)
          .order('county');
        if (cancelled || !data) return;
        list = data.map(r => r.county as string);
      } else {
        const { data } = await supabase
          .from('wells')
          .select('county')
          .eq('state_code', stateFilter)
          .not('county', 'is', null);
        if (cancelled || !data) return;
        list = [...new Set(data.map(r => r.county as string))].sort();
      }
      setCounties(list);
      await setCached(cacheKey, STATUSES_VERSION, list);
    }
    async function loadStatuses() {
      const cacheKey = `table:statuses_list:${stateFilter}`;
      const cached = await getCached<string[]>(cacheKey, STATUSES_VERSION, TTL_24H);
      if (cancelled) return;
      if (cached) { setStatuses(cached); return; }
      const { data } = await supabase
        .from('wells')
        .select('status')
        .eq('state_code', stateFilter)
        .not('status', 'is', null);
      if (cancelled || !data) return;
      const unique = [...new Set(data.map(r => r.status as string))].sort();
      setStatuses(unique);
      await setCached(cacheKey, STATUSES_VERSION, unique);
    }
    loadCounties();
    loadStatuses();
    return () => { cancelled = true; };
  }, [stateFilter]);

  // Township list is scoped to the selected county (townships aren't unique
  // across counties, and a state-wide distinct list would be huge). Reloads
  // whenever the county changes; cleared when no county is selected.
  useEffect(() => {
    let cancelled = false;
    if (!countyFilter) { setTownships([]); return; }
    async function loadTownships() {
      const cacheKey = `table:townships_list:${stateFilter}:${countyFilter}`;
      const cached = await getCached<string[]>(cacheKey, STATUSES_VERSION, TTL_24H);
      if (cancelled) return;
      if (cached) { setTownships(cached); return; }
      // Paginate to collect distinct townships — a populous county can exceed
      // the per-request row cap, which would otherwise truncate the list.
      const set = new Set<string>();
      let from = 0;
      const BATCH = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('well_table_view')
          .select('township')
          .eq('state_code', stateFilter)
          .eq('county', countyFilter)
          .not('township', 'is', null)
          .order('township')
          .range(from, from + BATCH - 1);
        if (cancelled) return;
        if (error || !data || data.length === 0) break;
        data.forEach(r => set.add(r.township as string));
        if (data.length < BATCH) break;
        from += BATCH;
      }
      const list = [...set].sort();
      setTownships(list);
      await setCached(cacheKey, STATUSES_VERSION, list);
    }
    loadTownships();
    return () => { cancelled = true; };
  }, [stateFilter, countyFilter]);

  // Fetch paginated/filtered/sorted data
  useEffect(() => {
    let cancelled = false;
    const cacheKey = 'table:rows:' + JSON.stringify({
      stc: stateFilter,
      q:   debouncedSearch,
      c:   countyFilter,
      tw:  townshipFilter,
      arc: appalachianOnly,
      pri: [...priorityFilter].sort(),
      st:  statusFilter,
      op:  operatorStatusFilter,
      ad:  adminStatusFilter,
      lp:  lastProdFilter,
      yi:  yearsInactiveFilter,
      au:  aumZoneOnly,
      du:  dogrmUrbanOnly,
      ao:  aumOpeningFilter,
      s:   sortCol,
      sd:  sortDir,
      p:   page,
    });

    async function fetchData() {
      setLoading(true);

      const cached = await getCached<{ rows: WellTableRow[]; total: number }>(cacheKey, TABLE_VERSION, TTL_24H);
      if (cancelled) return;
      if (cached) {
        setRows(cached.rows);
        setTotal(cached.total);
        setLoading(false);
        return;
      }

      let query = supabase
        .from('well_table_view')
        .select(
          'api_no,well_name,county,township,status,operator,well_type,' +
          'in_orphan_program,total_depth,permit_issued,completion_date,' +
          'last_nonzero_production_year,last_active_year,last_active_source,' +
          'priority,risk_score,composite_risk_score,water_risk_score,' +
          'population_risk_score,inactivity_score,nearest_water_distance_m,' +
          'within_protection_zone,operator_status,admin_status,population_within_1km,' +
          'population_within_5km,years_inactive,state_code,' +
          'in_aum_subsidence_zone,in_state_floodplain,' +
          'in_dogrm_urban_area,nearest_aum_opening_m,' +
          'nearest_tri_distance_m,nearest_tri_facility_name,nearest_tri_parent_company',
          { count: 'exact' }
        );

      query = query.eq('state_code', stateFilter);

      if (debouncedSearch) {
        query = query.or(
          `well_name.ilike.%${debouncedSearch}%,api_no.ilike.%${debouncedSearch}%`
        );
      }
      if (countyFilter)                                query = query.eq('county', countyFilter);
      else if (appalachianOnly && stateFilter === 'OH') query = query.in('county', ARC_COUNTIES);
      if (townshipFilter)        query = query.eq('township', townshipFilter);
      if (priorityFilter.length) query = query.in('priority', priorityFilter);
      if (statusFilter)          query = query.eq('status', statusFilter);
      if (operatorStatusFilter)  query = query.eq('operator_status', operatorStatusFilter);
      if (adminStatusFilter)     query = query.eq('admin_status', adminStatusFilter);

      // Last-produced calendar buckets — `never` = NULL last_nonzero_production_year.
      if (lastProdFilter === 'never')        query = query.is('last_nonzero_production_year', null);
      else if (lastProdFilter === 'before_2000') query = query.lt('last_nonzero_production_year', 2000);
      else if (lastProdFilter === '2000_2014')   query = query.gte('last_nonzero_production_year', 2000).lt('last_nonzero_production_year', 2015);
      else if (lastProdFilter === '2015_2019')   query = query.gte('last_nonzero_production_year', 2015).lt('last_nonzero_production_year', 2020);
      else if (lastProdFilter === '2020_plus')   query = query.gte('last_nonzero_production_year', 2020);

      // Years-inactive duration buckets.
      if (yearsInactiveFilter === 'under_5')      query = query.lt('years_inactive', 5);
      else if (yearsInactiveFilter === 'over_5')  query = query.gte('years_inactive', 5);
      else if (yearsInactiveFilter === 'over_20') query = query.gte('years_inactive', 20);
      else if (yearsInactiveFilter === 'over_50') query = query.gte('years_inactive', 50);

      // ── ODNR hazard-overlay filters (booleans + nearest mine-opening distance). ──
      if (aumZoneOnly)    query = query.eq('in_aum_subsidence_zone', true);
      if (dogrmUrbanOnly) query = query.eq('in_dogrm_urban_area',    true);
      if (aumOpeningFilter === 'under_500')      query = query.lt('nearest_aum_opening_m', 500);
      else if (aumOpeningFilter === 'under_1km') query = query.lt('nearest_aum_opening_m', 1000);
      else if (aumOpeningFilter === 'under_5km') query = query.lt('nearest_aum_opening_m', 5000);

      query = query.order(sortCol, { ascending: sortDir === 'asc', nullsFirst: false });
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (cancelled) return;
      if (!error && data) {
        const rows = data as unknown as WellTableRow[];
        const total = count ?? 0;
        setRows(rows);
        setTotal(total);
        await setCached(cacheKey, TABLE_VERSION, { rows, total });
      }
      setLoading(false);
    }
    fetchData();
    return () => { cancelled = true; };
  }, [stateFilter, debouncedSearch, countyFilter, townshipFilter, appalachianOnly, priorityFilter, statusFilter,
      operatorStatusFilter, adminStatusFilter, lastProdFilter, yearsInactiveFilter,
      aumZoneOnly, dogrmUrbanOnly, aumOpeningFilter,
      sortCol, sortDir, page]);

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
    setCountyQuery('');
    setCountyOpen(false);
    setTownshipFilter('');
    setTownshipQuery('');
    setTownshipOpen(false);
    setAppalachianOnly(false);
    setPriorityFilter([]);
    setStatusFilter('');
    setOperatorStatusFilter('');
    setAdminStatusFilter('');
    setLastProdFilter('');
    setYearsInactiveFilter('');
    setAumZoneOnly(false);
    setDogrmUrbanOnly(false);
    setAumOpeningFilter('');
    setPage(0);
    // stateFilter is intentionally NOT cleared — it's a scope, not a filter.
  }

  // Reset Ohio-specific filters when leaving Ohio.
  function handleStateChange(next: StateCode) {
    if (next === stateFilter) return;
    setStateFilter(next);
    setCountyFilter('');
    setCountyQuery('');
    setCountyOpen(false);
    setTownshipFilter('');
    setTownshipQuery('');
    setTownshipOpen(false);
    setAppalachianOnly(false);
    setStatusFilter('');         // status vocabularies differ across states
    setOperatorStatusFilter(''); // not populated for PA/WV
    setAdminStatusFilter('');    // OH-only view (well_admin_status)
    setLastProdFilter('');
    setYearsInactiveFilter('');
    setPriorityFilter([]);       // PA/WV have no risk scores
    // ODNR hazard overlays are OH-only (sourced from gis.ohiodnr.gov layers).
    setAumZoneOnly(false);
    setDogrmUrbanOnly(false);
    setAumOpeningFilter('');
    setPage(0);
  }

  function fmtCounty(c: string) {
    return c ? c.charAt(0) + c.slice(1).toLowerCase() : '';
  }

  const hasFilters = !!(
    search || countyFilter || townshipFilter || appalachianOnly || priorityFilter.length ||
    statusFilter || operatorStatusFilter || adminStatusFilter || lastProdFilter || yearsInactiveFilter ||
    aumZoneOnly || dogrmUrbanOnly || aumOpeningFilter
  );
  const isOhio = stateFilter === 'OH';

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
            'priority,risk_score,composite_risk_score,water_risk_score,population_risk_score,' +
            'inactivity_score,nearest_water_distance_m,within_protection_zone,' +
            'operator_status,admin_status,population_within_1km,population_within_5km,' +
            'years_inactive,lat,lng,state_code,' +
            'in_aum_subsidence_zone,in_state_floodplain,' +
            'in_dogrm_urban_area,nearest_aum_opening_m'
          );

        q = q.eq('state_code', stateFilter);

        if (debouncedSearch) q = q.or(`well_name.ilike.%${debouncedSearch}%,api_no.ilike.%${debouncedSearch}%`);
        if (countyFilter)                                 q = q.eq('county', countyFilter);
        else if (appalachianOnly && stateFilter === 'OH') q = q.in('county', ARC_COUNTIES);
        if (townshipFilter)        q = q.eq('township', townshipFilter);
        if (priorityFilter.length) q = q.in('priority', priorityFilter);
        if (statusFilter)          q = q.eq('status', statusFilter);
        if (operatorStatusFilter)  q = q.eq('operator_status', operatorStatusFilter);
        if (adminStatusFilter)     q = q.eq('admin_status', adminStatusFilter);

        if (lastProdFilter === 'never')         q = q.is('last_nonzero_production_year', null);
        else if (lastProdFilter === 'before_2000') q = q.lt('last_nonzero_production_year', 2000);
        else if (lastProdFilter === '2000_2014')   q = q.gte('last_nonzero_production_year', 2000).lt('last_nonzero_production_year', 2015);
        else if (lastProdFilter === '2015_2019')   q = q.gte('last_nonzero_production_year', 2015).lt('last_nonzero_production_year', 2020);
        else if (lastProdFilter === '2020_plus')   q = q.gte('last_nonzero_production_year', 2020);

        if (yearsInactiveFilter === 'under_5')      q = q.lt('years_inactive', 5);
        else if (yearsInactiveFilter === 'over_5')  q = q.gte('years_inactive', 5);
        else if (yearsInactiveFilter === 'over_20') q = q.gte('years_inactive', 20);
        else if (yearsInactiveFilter === 'over_50') q = q.gte('years_inactive', 50);

        // ── ODNR hazard-overlay filters (mirror fetchData) ──
        if (aumZoneOnly)    q = q.eq('in_aum_subsidence_zone', true);
        if (dogrmUrbanOnly) q = q.eq('in_dogrm_urban_area',    true);
        if (aumOpeningFilter === 'under_500')      q = q.lt('nearest_aum_opening_m', 500);
        else if (aumOpeningFilter === 'under_1km') q = q.lt('nearest_aum_opening_m', 1000);
        else if (aumOpeningFilter === 'under_5km') q = q.lt('nearest_aum_opening_m', 5000);

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
        'Admin Status':          r.admin_status ? (ADMIN_STATUS_LABEL[r.admin_status as AdminStatus] ?? r.admin_status) : '',
        'Operator':              r.operator ?? '',
        'In Orphan Program':     r.in_orphan_program ? 'Yes' : 'No',
        'Priority':              r.priority ?? '',
        'Risk Score':            r.composite_risk_score ?? '',
        'Water Risk':            r.water_risk_score ?? '',
        'Population Risk':       r.population_risk_score ?? '',
        'Inactivity Score':      r.inactivity_score ?? '',
        'Years Inactive':        r.years_inactive ?? '',
        'Last Active Year':      r.last_active_year ?? '',
        'Last Active Source':    r.last_active_source === 'compl' ? 'Completion date' : r.last_active_source === 'prod' ? 'Production record' : '',
        'Water Dist (mi)':       r.nearest_water_distance_m != null ? +metersToMiles(r.nearest_water_distance_m).toFixed(2) : '',
        'In Protection Zone':    r.within_protection_zone ? 'Yes' : 'No',
        [`Population ${RADIUS_1KM}`]: r.population_within_1km ?? '',
        [`Population ${RADIUS_5KM}`]: r.population_within_5km ?? '',
        'Well Type':             r.well_type ?? '',
        'Completion Date':       r.completion_date?.slice(0, 10) ?? '',
        'Permit Issued':         r.permit_issued?.slice(0, 10) ?? '',
        'Depth (ft)':            r.total_depth ?? '',
        'Latitude':              r.lat ?? '',
        'Longitude':             r.lng ?? '',
        // ── ODNR hazard overlays (Tier 1 informational, OH-only) ──
        'In AUM Subsidence':     r.in_aum_subsidence_zone ? 'Yes' : '',
        'In State Floodplain':   r.in_state_floodplain ? 'Yes' : '',
        'In DOGRM Urban':        r.in_dogrm_urban_area ? 'Yes' : '',
        'Nearest Mine Opening (ft)': r.nearest_aum_opening_m != null ? Math.round(metersToFeet(r.nearest_aum_opening_m)) : '',
        // ── TRI facility proximity (industrial-context informational) ──
        'Nearest TRI (ft)':         r.nearest_tri_distance_m != null ? Math.round(metersToFeet(r.nearest_tri_distance_m)) : '',
        'Nearest TRI Facility':    r.nearest_tri_facility_name ?? '',
        'Nearest TRI Parent':      r.nearest_tri_parent_company ?? '',
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
      // county_status_summary is Ohio-only; skip the sheet for PA/WV.
      const countyData = stateFilter === 'OH'
        ? (await supabase.from('county_status_summary').select('*').order('county')).data
        : null;

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
      XLSX.utils.book_append_sheet(wb, wsWells, 'Wells');
      if (countyData) XLSX.utils.book_append_sheet(wb, wsCounty, 'County Summary');

      const filterLabel = [
        appalachianOnly && stateFilter === 'OH' ? 'appalachian' : '',
        countyFilter    ? countyFilter.toLowerCase() : '',
        townshipFilter  ? townshipFilter.toLowerCase().replace(/\s+/g, '_') : '',
        priorityFilter.length ? priorityFilter.join('-') : '',
        statusFilter    ? statusFilter.toLowerCase().replace(/\s+/g, '_') : '',
      ].filter(Boolean).join('_');

      const statePrefix = stateFilter.toLowerCase();
      const filename = `${statePrefix}_wells${filterLabel ? '_' + filterLabel : ''}_${new Date().toISOString().slice(0,10)}.xlsx`;
      XLSX.writeFile(wb, filename);

    } finally {
      setExportLoading(false);
    }
  }

  // When Appalachian toggle is on, only show ARC counties in the dropdown.
  // WV stores county as numeric FIPS codes (001–109) rather than names; drop
  // those so the dropdown isn't a list of bare numbers.
  const visibleCounties = (appalachianOnly
    ? counties.filter(c => ARC_COUNTIES.includes(c))
    : counties
  ).filter(c => !/^\d+$/.test(c));
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startRow   = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const endRow     = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">

      <SiteHeader
        title="Table"
        leftExtra={
          <span>
            {loading
              ? 'Loading…'
              : total > 0
                ? `${startRow.toLocaleString()}–${endRow.toLocaleString()} of ${total.toLocaleString()} wells`
                : 'No results'}
          </span>
        }
        rightExtra={
          <button
            onClick={handleExport}
            disabled={exportLoading || loading}
            className="text-xs px-3 py-1 rounded border border-green-600 text-green-400 hover:bg-green-600 hover:text-black transition-colors disabled:opacity-40"
          >
            {exportLoading ? 'Preparing…' : '↓ Excel'}
          </button>
        }
      />

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0 flex-wrap">

        {/* State selector — segmented pill group */}
        <div className="flex items-center rounded border border-gray-600 overflow-hidden">
          {STATES.map(({ code, label }) => {
            const active = stateFilter === code;
            return (
              <button
                key={code}
                onClick={() => handleStateChange(code)}
                className="px-2 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: active ? '#3b82f6' : 'transparent',
                  color:           active ? '#000' : '#9ca3af',
                }}
                title={label}
              >
                {code}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search well name or API…"
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-gray-400 w-52"
        />

        {/* Appalachian toggle (Ohio-only — ARC counties are in OH) */}
        {isOhio && (
          <button
            onClick={() => { setAppalachianOnly(v => !v); setCountyFilter(''); setCountyQuery(''); setTownshipFilter(''); setPage(0); }}
            className="px-2 py-1 rounded text-xs font-medium border transition-colors"
            style={{
              borderColor:     '#a78bfa',
              color:           appalachianOnly ? '#000' : '#a78bfa',
              backgroundColor: appalachianOnly ? '#a78bfa' : 'transparent',
            }}
          >
            Appalachian
          </button>
        )}

        {/* County — searchable combobox */}
        <div className="relative">
          <input
            type="text"
            placeholder={appalachianOnly ? 'All ARC counties' : 'Search counties…'}
            value={countyOpen ? countyQuery : fmtCounty(countyFilter)}
            onFocus={() => { setCountyOpen(true); setCountyQuery(''); }}
            onChange={e => { setCountyQuery(e.target.value); setCountyOpen(true); }}
            onBlur={() => setTimeout(() => setCountyOpen(false), 150)}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-gray-400 w-44"
          />
          {countyOpen && (() => {
            const q = countyQuery.trim().toLowerCase();
            const matches = q
              ? visibleCounties.filter(c => c.toLowerCase().includes(q))
              : visibleCounties;
            return (
              <div className="absolute z-30 mt-1 max-h-64 overflow-auto bg-gray-800 border border-gray-600 rounded text-xs w-56 shadow-lg">
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); setCountyFilter(''); setCountyQuery(''); setCountyOpen(false); setTownshipFilter(''); setPage(0); }}
                  className={`block w-full text-left px-3 py-1.5 hover:bg-gray-700 ${countyFilter === '' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}
                >
                  {appalachianOnly ? 'All ARC counties' : 'All counties'}
                </button>
                {matches.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">No matches</div>
                )}
                {matches.map(c => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault();
                      setCountyFilter(c);
                      setCountyQuery('');
                      setCountyOpen(false);
                      setTownshipFilter('');
                      setPage(0);
                    }}
                    className={`block w-full text-left px-3 py-1.5 hover:bg-gray-700 ${countyFilter === c ? 'bg-gray-700 text-white' : 'text-gray-300'}`}
                  >
                    {fmtCounty(c)}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Township — searchable combobox, scoped to the selected county */}
        {countyFilter && (
        <div className="relative">
          <input
            type="text"
            placeholder="Search townships…"
            value={townshipOpen ? townshipQuery : townshipFilter}
            onFocus={() => { setTownshipOpen(true); setTownshipQuery(''); }}
            onChange={e => { setTownshipQuery(e.target.value); setTownshipOpen(true); }}
            onBlur={() => setTimeout(() => setTownshipOpen(false), 150)}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs placeholder-gray-500 focus:outline-none focus:border-gray-400 w-40"
          />
          {townshipOpen && (() => {
            const q = townshipQuery.trim().toLowerCase();
            const matches = q
              ? townships.filter(t => t.toLowerCase().includes(q))
              : townships;
            return (
              <div className="absolute z-30 mt-1 max-h-64 overflow-auto bg-gray-800 border border-gray-600 rounded text-xs w-56 shadow-lg">
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); setTownshipFilter(''); setTownshipQuery(''); setTownshipOpen(false); setPage(0); }}
                  className={`block w-full text-left px-3 py-1.5 hover:bg-gray-700 ${townshipFilter === '' ? 'bg-gray-700 text-white' : 'text-gray-400'}`}
                >
                  All townships
                </button>
                {townships.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">No townships</div>
                )}
                {matches.length === 0 && townships.length > 0 && (
                  <div className="px-3 py-2 text-gray-500">No matches</div>
                )}
                {matches.map(t => (
                  <button
                    key={t}
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault();
                      setTownshipFilter(t);
                      setTownshipQuery('');
                      setTownshipOpen(false);
                      setPage(0);
                    }}
                    className={`block w-full text-left px-3 py-1.5 hover:bg-gray-700 ${townshipFilter === t ? 'bg-gray-700 text-white' : 'text-gray-300'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
        )}

        {/* Priority pills (Ohio-only — risk scores not computed for PA/WV) */}
        {isOhio && (
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
        )}

        {/* Status */}
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400 max-w-44"
        >
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Operator status (Ohio-only — derived from OH RBDMS) */}
        {isOhio && (
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
        )}

        {/* Admin status — operational classification with hidden-orphan categories (Ohio-only) */}
        {isOhio && (
        <select
          value={adminStatusFilter}
          onChange={e => { setAdminStatusFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
        >
          <option value="">All admin statuses</option>
          <option value="orphan_program">Orphan Program</option>
          <option value="orphan_official">Orphan (Official)</option>
          <option value="historic_owner">Historic Owner</option>
          <option value="zombie_producer">Producing, No Recent Output</option>
          <option value="paperwork_producer">No Production Filed</option>
          <option value="permit_expired">Permit Expired</option>
          <option value="drilled_never_produced">Drilled, No Production</option>
          <option value="status_unknown">Status Unknown</option>
          <option value="well_extinct">Well Not Found</option>
          <option value="permit_cancelled">Permit Cancelled</option>
          <option value="named_operator">Named Operator</option>
          <option value="unknown">Unknown</option>
        </select>
        )}

        {/* Last produced — calendar bucket. "Never produced" is null. (Ohio-only — production_year backfilled for OH only) */}
        {isOhio && (
        <select
          value={lastProdFilter}
          onChange={e => { setLastProdFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
          title="Filter by year of last reported production"
        >
          <option value="">Last produced (any)</option>
          <option value="never">Never produced</option>
          <option value="before_2000">Before 2000</option>
          <option value="2000_2014">2000–2014</option>
          <option value="2015_2019">2015–2019</option>
          <option value="2020_plus">2020 or later</option>
        </select>
        )}

        {/* Years inactive — duration threshold. (Ohio-only) */}
        {isOhio && (
        <select
          value={yearsInactiveFilter}
          onChange={e => { setYearsInactiveFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
          title="Filter by computed years since last reported production"
        >
          <option value="">Years inactive (any)</option>
          <option value="under_5">Active (&lt; 5 yrs)</option>
          <option value="over_5">≥ 5 years</option>
          <option value="over_20">≥ 20 years</option>
          <option value="over_50">≥ 50 years (legacy)</option>
        </select>
        )}

        {/* ── ODNR hazard overlays (Tier 1 informational, Ohio-only — sourced from gis.ohiodnr.gov) ── */}
        {isOhio && <HazardToggle label="Mine subsidence"  color="#b45309" active={aumZoneOnly}    onClick={() => { setAumZoneOnly(v => !v);    setPage(0); }} title="Well sits inside a mapped Abandoned Underground Mine (ODNR DGS)" />}
        {isOhio && <HazardToggle label="DOGRM urban"      color="#ec4899" active={dogrmUrbanOnly} onClick={() => { setDogrmUrbanOnly(v => !v); setPage(0); }} title="Well sits inside DOGRM's regulatory urban-area definition (tighter than census urban)" />}

        {isOhio && (
        <select
          value={aumOpeningFilter}
          onChange={e => { setAumOpeningFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-gray-400"
          title="Distance to nearest mapped abandoned-mine opening (point hazard)"
        >
          <option value="">Mine opening (any dist)</option>
          <option value="under_500">≤ 0.3 mi</option>
          <option value="under_1km">≤ 0.6 mi</option>
          <option value="under_5km">≤ 3 mi</option>
        </select>
        )}

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
              <Col label="Risk"         col="composite_risk_score"        sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="API No"       col="api_no"                      sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Well Name"    col="well_name"                   sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="County"       col="county"                      sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Township"     col="township"                    sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Status"       col="status"                      sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Oper. Status" col="operator_status"             sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Admin Status" col="admin_status"                sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Operator"     col="operator"                    sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Orphan"       col="in_orphan_program"           sort={sortCol} dir={sortDir} onSort={handleSort} center />
              <Col label="Yrs Inactive" col="years_inactive"              sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Last Active"  col="last_active_year"            sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Water Dist"   col="nearest_water_distance_m"   sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="In Zone"      col="within_protection_zone"      sort={sortCol} dir={sortDir} onSort={handleSort} center />
              <Col label="Water Risk"   col="water_risk_score"            sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Pop Risk"     col="population_risk_score"       sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Inactivity"   col="inactivity_score"            sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label={`Pop ${RADIUS_1KM}`}  col="population_within_1km"       sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label={`Pop ${RADIUS_5KM}`}  col="population_within_5km"       sort={sortCol} dir={sortDir} onSort={handleSort} right />
              <Col label="Type"         col="well_type"                   sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Completion"   col="completion_date"             sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Permit"       col="permit_issued"               sort={sortCol} dir={sortDir} onSort={handleSort} />
              <Col label="Depth (ft)"   col="total_depth"                 sort={sortCol} dir={sortDir} onSort={handleSort} right />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={24} className="text-center py-10 text-gray-500">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={24} className="text-center py-10 text-gray-500">No wells match these filters.</td>
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

// ── Hazard toggle pill ────────────────────────────────────────────────────────
// Mirrors the Appalachian-toggle pattern: outlined when off, solid-filled when on.
// Used for ODNR overlay booleans (mine subsidence, AML cleanup, floodplain, urban).

function HazardToggle({
  label, color, active, onClick, title,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-2 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap"
      style={{
        borderColor:     color,
        color:           active ? '#000' : color,
        backgroundColor: active ? color  : 'transparent',
      }}
    >
      {label}
    </button>
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

      {/* Risk score — composite (6-dimension); this is what `priority` is derived from */}
      <td className="px-2 py-1 font-mono text-right whitespace-nowrap">
        {row.composite_risk_score != null
          ? <span style={{ color: riskColor(row.composite_risk_score) }}>{row.composite_risk_score.toFixed(1)}</span>
          : <Dash />}
      </td>

      {/* API No */}
      <td className="px-2 py-1 font-mono text-gray-400 whitespace-nowrap">
        <Link
          href={`/wells/${encodeURIComponent(row.api_no)}`}
          className="hover:text-white hover:underline underline-offset-2"
        >
          {row.api_no}
        </Link>
      </td>

      {/* Well Name */}
      <td className="px-2 py-1 max-w-44 truncate" title={row.well_name ?? ''}>
        {row.well_name ?? <Dash />}
      </td>

      {/* County */}
      <td className="px-2 py-1 whitespace-nowrap">
        {row.county ? (
          <Link
            href={`/counties/${encodeURIComponent(row.county)}`}
            className="hover:text-white hover:underline underline-offset-2"
          >
            {titleCase(row.county)}
          </Link>
        ) : <Dash />}
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

      {/* Admin status */}
      <td className="px-2 py-1 whitespace-nowrap">
        {row.admin_status
          ? <span style={{ color: ADMIN_STATUS_COLOR[row.admin_status as AdminStatus] ?? '#fff' }}>
              {ADMIN_STATUS_LABEL[row.admin_status as AdminStatus] ?? row.admin_status}
            </span>
          : <Dash />}
      </td>

      {/* Operator */}
      <td className="px-2 py-1 max-w-40 truncate text-gray-300" title={row.operator ?? ''}>
        {row.operator ? (
          <Link
            href={`/operators/${encodeURIComponent(row.operator)}`}
            className="hover:text-white hover:underline underline-offset-2"
          >
            {row.operator}
          </Link>
        ) : <Dash />}
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
        {formatDistanceUS(row.nearest_water_distance_m)}
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
