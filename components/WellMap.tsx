'use client';

import { useEffect, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Priority, PRIORITY_COLOR, CountySummary, NearYouResult, WellDetail } from '@/lib/types';
import {
  COLOR_MODE_SCORE_FIELD,
  rsScoreColorExpr,
  RS_FLAG_EXPR,
  HAZARD_FLAG_EXPR,
  aumOpeningDistanceExpr,
  triDistanceExpr,
  ACTIVITY_LEVELS,
  PRIORITY_ORDER,
} from '@/lib/mapExpressions';
import {
  loadHydrography,
  loadParcelsByBbox,
  loadParcelsByCounty,
  loadPlumes,
  loadSpills,
  loadSchools,
  loadHospitals,
  loadOdnrHazards,
} from '@/lib/mapDataLoaders';
import { useMapStore } from '@/lib/mapStore';
import { useMapInit } from '@/components/map/hooks/useMapInit';
import SearchBox from '@/components/map/SearchBox';
import WellsControlPanel from '@/components/map/WellsControlPanel';
import LayersPanel from '@/components/map/LayersPanel';
import HoverTooltip from '@/components/map/HoverTooltip';
import LoadStatusBanner from '@/components/map/LoadStatusBanner';

const PARCELS_USE_PMTILES = !!process.env.NEXT_PUBLIC_PARCELS_PMTILES_URL;

interface Props {
  filters: Priority[];
  onFilterChange: (p: Priority) => void;
  onSelectWell: (well: WellDetail | null) => void;
  onSelectCounty: (county: CountySummary | null) => void;
  selectedCounty: CountySummary | null;
  onNearYouResult: (result: NearYouResult | null) => void;
  centerOn?: { lat: number; lng: number } | null;
}

export default function WellMap({ filters, onFilterChange, onSelectWell, onSelectCounty, selectedCounty, onNearYouResult, centerOn }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useMapInit(mapContainer, map, onSelectWell, onSelectCounty);

  // Reactive state — drives the per-frame visibility/filter/color sync below.
  const landCoverFilter   = useMapStore((s) => s.landCoverFilter);
  const satellite         = useMapStore((s) => s.satellite);
  const cycleSatellite    = useMapStore((s) => s.cycleSatellite);
  const showCounties      = useMapStore((s) => s.showCounties);
  const showHydrography   = useMapStore((s) => s.showHydrography);
  const hydrographyLoaded     = useMapStore((s) => s.hydrographyLoaded);
  const setHydrographyLoaded  = useMapStore((s) => s.setHydrographyLoaded);
  const showPlumes        = useMapStore((s) => s.showPlumes);
  const plumesLoaded      = useMapStore((s) => s.plumesLoaded);
  const setPlumesLoaded   = useMapStore((s) => s.setPlumesLoaded);
  const showSpills        = useMapStore((s) => s.showSpills);
  const oilGasSpillsOnly  = useMapStore((s) => s.oilGasSpillsOnly);
  const spillsLoaded      = useMapStore((s) => s.spillsLoaded);
  const setSpillsLoaded   = useMapStore((s) => s.setSpillsLoaded);
  const showSchools       = useMapStore((s) => s.showSchools);
  const schoolsLoaded     = useMapStore((s) => s.schoolsLoaded);
  const setSchoolsLoaded  = useMapStore((s) => s.setSchoolsLoaded);
  const showHospitals       = useMapStore((s) => s.showHospitals);
  const hospitalsLoaded     = useMapStore((s) => s.hospitalsLoaded);
  const setHospitalsLoaded  = useMapStore((s) => s.setHospitalsLoaded);
  const showPaOilgas        = useMapStore((s) => s.showPaOilgas);
  const showParcels       = useMapStore((s) => s.showParcels);
  const setParcelsLoading = useMapStore((s) => s.setParcelsLoading);
  const colorMode         = useMapStore((s) => s.colorMode);
  const rsFlags           = useMapStore((s) => s.rsFlags);
  const activityFilters   = useMapStore((s) => s.activityFilters);
  const orphansOnly       = useMapStore((s) => s.orphansOnly);
  const hazardFlags        = useMapStore((s) => s.hazardFlags);
  const aumOpeningDistance = useMapStore((s) => s.aumOpeningDistance);
  const triDistance        = useMapStore((s) => s.triDistance);
  // ODNR hazard polygon overlays (visible polygons, distinct from the dot
  // filters above which hide/show wells).
  const showAumMines           = useMapStore((s) => s.showAumMines);
  const showDogrmUrbanArea     = useMapStore((s) => s.showDogrmUrbanArea);
  const odnrHazardsLoaded      = useMapStore((s) => s.odnrHazardsLoaded);
  const setOdnrHazardsLoaded   = useMapStore((s) => s.setOdnrHazardsLoaded);


  // Sync filter visibility whenever filters prop changes
  useEffect(() => {
    if (!map.current) return;
    PRIORITY_ORDER.forEach(priority => {
      const vis = filters.includes(priority) ? 'visible' : 'none';
      const layerId = `wells-${priority}`;
      if (map.current!.getLayer(layerId))
        map.current!.setLayoutProperty(layerId, 'visibility', vis);
      const glowId = `wells-${priority}-glow`;
      if (map.current!.getLayer(glowId))
        map.current!.setLayoutProperty(glowId, 'visibility', vis);
    });
  }, [filters]);

  // Rebuild per-layer filter expressions whenever land-cover or RS flags change.
  // Each wells-<priority> layer originally used:
  //     ['==', ['get', 'priority'], priority]
  // We AND that with: land-cover `in` check, and OR-combined RS flag checks.
  useEffect(() => {
    if (!map.current) return;
    const lcExpr: mapboxgl.Expression | null =
      landCoverFilter === 'all'
        ? null
        : ['in', ['get', 'land_cover'], ['literal', Array.from(landCoverFilter)]];

    const flagExprs = Array.from(rsFlags).map(f => RS_FLAG_EXPR[f]);
    const flagExpr: mapboxgl.Expression | null =
      flagExprs.length === 0 ? null
      : flagExprs.length === 1 ? flagExprs[0]
      : (['any', ...flagExprs] as mapboxgl.Expression);

    // Hard filter: exclude wells that have an active named operator. Applied
    // to every priority tier (including critical) because this is an explicit
    // plugging-candidate intent, unlike RS flags which are soft signals.
    const orphanExpr: mapboxgl.Expression | null = orphansOnly
      ? ['!=', ['get', 'operator_status'], 'named_operator']
      : null;

    // Activity filter (AND'd onto every tier). When all levels are selected we
    // skip the expression so the filter is a no-op — no runtime cost in Mapbox.
    const activityExpr: mapboxgl.Expression | null =
      activityFilters.size === ACTIVITY_LEVELS.length
        ? null
        : ['in', ['get', 'activity'], ['literal', Array.from(activityFilters)]];

    // Hazard filters (ODNR overlays). Applied as a hard AND on every tier
    // including critical — these are regulator-mapped polygons, not soft RS
    // signals, so the user's filter intent is unambiguous: "wells in this
    // hazard zone, regardless of priority". Multiple hazard booleans AND
    // together (intersection); the opening-distance expression AND's too.
    const hazardBoolExprs = Array.from(hazardFlags).map(f => HAZARD_FLAG_EXPR[f]);
    const openingExpr     = aumOpeningDistanceExpr(aumOpeningDistance);
    const triExpr         = triDistanceExpr(triDistance);
    const hazardParts: mapboxgl.Expression[] = [...hazardBoolExprs];
    if (openingExpr) hazardParts.push(openingExpr);
    if (triExpr)     hazardParts.push(triExpr);
    const hazardExpr: mapboxgl.Expression | null =
      hazardParts.length === 0 ? null
      : hazardParts.length === 1 ? hazardParts[0]
      : (['all', ...hazardParts] as mapboxgl.Expression);

    PRIORITY_ORDER.forEach(priority => {
      const base: mapboxgl.Expression = ['==', ['get', 'priority'], priority];
      const parts: mapboxgl.Expression[] = [base];
      if (lcExpr) parts.push(lcExpr);
      // Critical is the top tier by composite score — the scoring system has
      // already "flagged" these. RS flags are filters meant to narrow the bulk
      // of wells down to specific signals, so applying them to critical would
      // hide wells that are already maximally prioritised. Critical therefore
      // ignores RS flags and stays visible whenever its priority filter is on.
      if (flagExpr && priority !== 'critical') parts.push(flagExpr);
      if (orphanExpr)   parts.push(orphanExpr);
      if (activityExpr) parts.push(activityExpr);
      // Hazards apply to every tier (see comment above) — no critical carveout.
      if (hazardExpr)   parts.push(hazardExpr);
      const combined: mapboxgl.Expression =
        parts.length === 1 ? parts[0] : (['all', ...parts] as mapboxgl.Expression);
      const layerId = `wells-${priority}`;
      const glowId  = `wells-${priority}-glow`;
      if (map.current!.getLayer(layerId)) map.current!.setFilter(layerId, combined);
      if (map.current!.getLayer(glowId))  map.current!.setFilter(glowId,  combined);
    });
  }, [landCoverFilter, rsFlags, orphansOnly, activityFilters, hazardFlags, aumOpeningDistance, triDistance]);

  // Dot recolors by selected RS score; glow stays pinned to PRIORITY_COLOR so
  // critical/high tiers remain recognizable even when most of their dots would
  // score 0 on the selected RS dimension and render as dark basemap-blue.
  useEffect(() => {
    if (!map.current) return;
    PRIORITY_ORDER.forEach(priority => {
      const layerId = `wells-${priority}`;
      const glowId  = `wells-${priority}-glow`;
      const dotColor: string | mapboxgl.Expression =
        colorMode === 'priority'
          ? PRIORITY_COLOR[priority]
          : rsScoreColorExpr(COLOR_MODE_SCORE_FIELD[colorMode]);
      if (map.current!.getLayer(layerId)) map.current!.setPaintProperty(layerId, 'circle-color', dotColor);
      if (map.current!.getLayer(glowId))  map.current!.setPaintProperty(glowId,  'circle-color', PRIORITY_COLOR[priority]);
    });
  }, [colorMode]);

  // Toggle methane plumes layer + lazy-load GeoJSON on first show
  useEffect(() => {
    if (!map.current?.getLayer('methane-plumes-dot')) return;
    const vis = showPlumes ? 'visible' : 'none';
    map.current.setLayoutProperty('methane-plumes-dot',  'visibility', vis);
    map.current.setLayoutProperty('methane-plumes-glow', 'visibility', vis);
    if (showPlumes && !plumesLoaded) {
      loadPlumes(map.current).then(ok => { if (ok) setPlumesLoaded(true); });
    }
  }, [showPlumes, plumesLoaded]);

  // Toggle Ohio public schools layer + lazy-load on first show
  useEffect(() => {
    if (!map.current?.getLayer('schools-dot')) return;
    const vis = showSchools ? 'visible' : 'none';
    map.current.setLayoutProperty('schools-dot', 'visibility', vis);
    if (showSchools && !schoolsLoaded) {
      loadSchools(map.current).then(ok => { if (ok) setSchoolsLoaded(true); });
    }
  }, [showSchools, schoolsLoaded, setSchoolsLoaded]);

  // Toggle Ohio hospitals layer + lazy-load on first show
  useEffect(() => {
    if (!map.current?.getLayer('hospitals-dot')) return;
    const vis = showHospitals ? 'visible' : 'none';
    map.current.setLayoutProperty('hospitals-dot', 'visibility', vis);
    if (showHospitals && !hospitalsLoaded) {
      loadHospitals(map.current).then(ok => { if (ok) setHospitalsLoaded(true); });
    }
  }, [showHospitals, hospitalsLoaded, setHospitalsLoaded]);

  // Toggle ODNR hazard polygon overlays (2 layer_types share one source).
  // Each toggle independently flips visibility for its fill+outline pair;
  // the load fires once when ANY toggle first turns on (one round trip,
  // two togglable layers).
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer('odnr-hazards-aum_mine-fill')) return;
    const layers: Array<[boolean, string]> = [
      [showAumMines,       'aum_mine'],
      [showDogrmUrbanArea, 'dogrm_urban_area'],
    ];
    for (const [show, key] of layers) {
      const vis = show ? 'visible' : 'none';
      m.setLayoutProperty(`odnr-hazards-${key}-fill`,    'visibility', vis);
      m.setLayoutProperty(`odnr-hazards-${key}-outline`, 'visibility', vis);
    }
    const anyOn = layers.some(([show]) => show);
    if (anyOn && !odnrHazardsLoaded) {
      loadOdnrHazards(m).then(ok => { if (ok) setOdnrHazardsLoaded(true); });
    }
  }, [showAumMines, showDogrmUrbanArea, odnrHazardsLoaded, setOdnrHazardsLoaded]);

  // Toggle PA DEP oil & gas locations layer (CDN-served Mapbox tileset, no
  // lazy-load gate — vector tiles arrive as the map renders).
  useEffect(() => {
    if (!map.current?.getLayer('pa-oilgas-dot')) return;
    map.current.setLayoutProperty('pa-oilgas-dot', 'visibility', showPaOilgas ? 'visible' : 'none');
  }, [showPaOilgas]);

  // Toggle OEPA spills layer + lazy-load on first show. The oil/gas filter
  // changes the underlying feature set, so toggleOilGasSpillsOnly resets
  // spillsLoaded in the store and we re-fetch here.
  useEffect(() => {
    if (!map.current?.getLayer('oepa-spills-dot')) return;
    const vis = showSpills ? 'visible' : 'none';
    map.current.setLayoutProperty('oepa-spills-dot',  'visibility', vis);
    map.current.setLayoutProperty('oepa-spills-glow', 'visibility', vis);
    if (showSpills && !spillsLoaded) {
      loadSpills(map.current, oilGasSpillsOnly).then(ok => { if (ok) setSpillsLoaded(true); });
    }
  }, [showSpills, spillsLoaded, oilGasSpillsOnly]);

  // Sync satellite layer visibility
  useEffect(() => {
    if (!map.current?.getLayer('satellite-layer')) return;
    map.current.setLayoutProperty('bing-layer',      'visibility', satellite === 'bing'   ? 'visible' : 'none');
    map.current.setLayoutProperty('esri-layer',      'visibility', satellite === 'esri'   ? 'visible' : 'none');
    map.current.setLayoutProperty('satellite-layer', 'visibility', satellite === 'mapbox' ? 'visible' : 'none');
    map.current.setLayoutProperty('osip-layer',      'visibility', satellite === 'osip'   ? 'visible' : 'none');
  }, [satellite]);

  // Fly to well when selected via API lookup
  useEffect(() => {
    if (!centerOn || !map.current) return;
    map.current.flyTo({ center: [centerOn.lng, centerOn.lat], zoom: Math.max(map.current.getZoom(), 13), duration: 700, essential: true });
  }, [centerOn]);

  // Toggle county layer visibility
  useEffect(() => {
    if (!map.current?.getLayer('counties-fill')) return;
    const vis = showCounties ? 'visible' : 'none';
    map.current.setLayoutProperty('counties-fill', 'visibility', vis);
    map.current.setLayoutProperty('counties-line', 'visibility', vis);
    map.current.setLayoutProperty('counties-selected-glow',    'visibility', vis);
    map.current.setLayoutProperty('counties-selected-outline', 'visibility', vis);
  }, [showCounties]);

  // Toggle NHD hydrography (rivers + lakes) + lazy-load on first show
  useEffect(() => {
    if (!map.current?.getLayer('hydrography-flowlines')) return;
    const vis = showHydrography ? 'visible' : 'none';
    map.current.setLayoutProperty('hydrography-waterbodies-fill',    'visibility', vis);
    map.current.setLayoutProperty('hydrography-waterbodies-outline', 'visibility', vis);
    map.current.setLayoutProperty('hydrography-flowlines',           'visibility', vis);
    if (showHydrography && !hydrographyLoaded) {
      loadHydrography(map.current).then(ok => { if (ok) setHydrographyLoaded(true); });
    }
  }, [showHydrography, hydrographyLoaded]);

  // Highlight the currently selected county with a bright outline + glow.
  // Use legacy filter syntax (['==', 'prop', value]) for broadest compat.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer('counties-selected-outline')) return;
    const fips = selectedCounty?.fips_code ?? '__none__';
    m.setFilter('counties-selected-outline', ['==', 'fips_code', fips]);
    m.setFilter('counties-selected-glow',    ['==', 'fips_code', fips]);
  }, [selectedCounty?.fips_code]);

  // Parcels: 5.8M+ statewide. Two modes:
  //   • County selected → ONE fetch of all parcels for that county. No
  //     refetch on pan/zoom — the whole county sits in the source until
  //     the user picks a different county. Mirrors how Hocking-only used
  //     to behave.
  //   • No county selected → bbox fetch with debounced refetch on pan/zoom
  //     so the user can still see context if they explore raw.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer('parcels-fill')) return;
    const vis = showParcels ? 'visible' : 'none';
    m.setLayoutProperty('parcels-fill',    'visibility', vis);
    m.setLayoutProperty('parcels-outline', 'visibility', vis);

    // Vector-tile mode: Mapbox handles tile fetching automatically. The county
    // selection becomes a layer filter rather than a refetch — this keeps tile
    // bytes already in cache (highlighting only one county doesn't re-download
    // anything). Filter by `null` clears it.
    if (PARCELS_USE_PMTILES) {
      // parcelsLoading is never set true in vector-tile mode (no fetch round-trip),
      // so we don't need to reset it here.
      const filter = selectedCounty?.county
        ? (['==', ['get', 'county'], selectedCounty.county] as mapboxgl.Expression)
        : null;
      m.setFilter('parcels-fill',    filter);
      m.setFilter('parcels-outline', filter);
      return;
    }

    if (!showParcels) {
      (m.getSource('parcels') as mapboxgl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection', features: [],
      });
      setParcelsLoading(false);
      return;
    }

    let cancelled = false;

    if (selectedCounty?.county) {
      setParcelsLoading(true);
      loadParcelsByCounty(m, selectedCounty.county)
        .finally(() => { if (!cancelled) setParcelsLoading(false); });
      return () => { cancelled = true; };
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (cancelled) return;
      if (m.getZoom() < 9) return;
      setParcelsLoading(true);
      loadParcelsByBbox(m).finally(() => { if (!cancelled) setParcelsLoading(false); });
    };
    const onMove = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refetch, 250);
    };
    refetch();
    m.on('moveend', onMove);
    m.on('zoomend', onMove);
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      m.off('moveend', onMove);
      m.off('zoomend', onMove);
    };
  }, [showParcels, selectedCounty?.county]);



  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Map controls — top-left */}
      <div className="absolute top-3 left-3 flex flex-col gap-2">

        <SearchBox mapRef={map} onNearYouResult={onNearYouResult} />

        {/* Reset view */}
        <button
          onClick={() => map.current?.flyTo({ center: [-82.8, 40.4], zoom: 6.5, duration: 800, essential: true })}
          className="px-3 py-1.5 rounded text-xs font-medium border transition-colors"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
          title="Reset to Ohio view"
        >
          ⌂ Ohio
        </button>

        {/* Satellite toggle — cycles off → Bing → Esri → Mapbox → Ohio OSIP → off */}
        <button
          onClick={cycleSatellite}
          className="px-3 py-1.5 rounded text-xs font-medium border transition-colors"
          style={{
            backgroundColor: satellite !== 'off' ? '#fff' : 'rgba(0,0,0,0.7)',
            color:            satellite !== 'off' ? '#000' : '#fff',
            borderColor:      satellite !== 'off' ? '#ccc' : 'rgba(255,255,255,0.3)',
          }}
        >
          🛰 {satellite === 'bing' ? 'Bing (Vexcel)' : satellite === 'esri' ? 'Esri imagery' : satellite === 'mapbox' ? 'Mapbox imagery' : satellite === 'osip' ? 'Ohio OSIP (current)' : 'Satellite'}
        </button>

        <WellsControlPanel filters={filters} onFilterChange={onFilterChange} />
        <LayersPanel selectedCounty={selectedCounty} />
      </div>

      <HoverTooltip />
      <LoadStatusBanner />
    </div>
  );
}
