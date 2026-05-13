import { create } from 'zustand';
import type { LandCoverCode } from '@/lib/types';
import {
  ACTIVITY_LEVELS,
  LAND_COVER_CODES,
  type ActivityLevel,
  type AumOpeningDistance,
  type ColorMode,
  type CountyMetric,
  type HazardFlag,
  type HoverInfo,
  type RsFlag,
  type SatelliteMode,
  type TriDistance,
  type WellsTab,
} from '@/lib/mapExpressions';

const SATELLITE_CYCLE: SatelliteMode[] = ['off', 'bing', 'esri', 'mapbox', 'osip'];

interface MapState {
  // Filter dimensions (drive the wells layer filter expression)
  activityFilters: Set<ActivityLevel>;
  colorMode: ColorMode;
  rsFlags: Set<RsFlag>;
  orphansOnly: boolean;
  landCoverFilter: Set<LandCoverCode> | 'all';
  // ODNR hazard overlays — apply as hard filters to every priority tier.
  hazardFlags: Set<HazardFlag>;
  aumOpeningDistance: AumOpeningDistance;
  triDistance: TriDistance;

  // UI tab + visual mode
  wellsTab: WellsTab;
  satellite: SatelliteMode;
  countyMetric: CountyMetric;

  // Layer visibility toggles
  showCounties: boolean;
  showWaterSources: boolean;
  showHydrography: boolean;
  showPlumes: boolean;
  showParcels: boolean;
  showSpills: boolean;
  showSchools: boolean;
  showHospitals: boolean;
  showPaOilgas: boolean;
  oilGasSpillsOnly: boolean;
  // ODNR hazard polygon overlays — each layer_type toggled independently,
  // but all share one /api/odnr-hazards round trip and one source.
  showAumMines: boolean;
  showDogrmUrbanArea: boolean;

  // Lazy-load tracking (separate from visibility — first show triggers fetch)
  waterSourcesLoaded: boolean;
  hydrographyLoaded: boolean;
  plumesLoaded: boolean;
  parcelsLoading: boolean;
  spillsLoaded: boolean;
  schoolsLoaded: boolean;
  hospitalsLoaded: boolean;
  odnrHazardsLoaded: boolean;

  // Hover tooltip + bottom load banner
  hoverInfo: HoverInfo | null;
  loadStatus: string;

  // Actions
  toggleActivity: (level: ActivityLevel) => void;
  resetActivity: () => void;
  setColorMode: (mode: ColorMode) => void;
  toggleRsFlag: (flag: RsFlag) => void;
  clearRsFlags: () => void;
  toggleOrphansOnly: () => void;
  toggleLandCover: (code: LandCoverCode) => void;
  resetLandCover: () => void;
  toggleHazardFlag: (flag: HazardFlag) => void;
  clearHazardFlags: () => void;
  setAumOpeningDistance: (level: AumOpeningDistance) => void;
  setTriDistance: (level: TriDistance) => void;
  setWellsTab: (tab: WellsTab) => void;
  cycleSatellite: () => void;
  setCountyMetric: (metric: CountyMetric) => void;
  toggleShowCounties: () => void;
  toggleShowWaterSources: () => void;
  toggleShowHydrography: () => void;
  toggleShowPlumes: () => void;
  toggleShowParcels: () => void;
  toggleShowSpills: () => void;
  toggleShowSchools: () => void;
  toggleShowHospitals: () => void;
  toggleShowPaOilgas: () => void;
  toggleOilGasSpillsOnly: () => void;
  toggleShowAumMines: () => void;
  toggleShowDogrmUrbanArea: () => void;
  setOdnrHazardsLoaded: (v: boolean) => void;
  setWaterSourcesLoaded: (v: boolean) => void;
  setHydrographyLoaded: (v: boolean) => void;
  setPlumesLoaded: (v: boolean) => void;
  setParcelsLoading: (v: boolean) => void;
  setSpillsLoaded: (v: boolean) => void;
  setSchoolsLoaded: (v: boolean) => void;
  setHospitalsLoaded: (v: boolean) => void;
  setHoverInfo: (info: HoverInfo | null) => void;
  setLoadStatus: (status: string) => void;
}

export const useMapStore = create<MapState>((set) => ({
  activityFilters: new Set<ActivityLevel>(ACTIVITY_LEVELS),
  colorMode: 'priority',
  rsFlags: new Set<RsFlag>(),
  orphansOnly: false,
  landCoverFilter: 'all',
  hazardFlags: new Set<HazardFlag>(),
  aumOpeningDistance: 'any',
  triDistance: 'any',

  wellsTab: 'priority',
  satellite: 'off',
  countyMetric: 'avg_risk_score',

  showCounties: true,
  showWaterSources: false,
  showHydrography: false,
  showPlumes: false,
  showParcels: false,
  showSpills: false,
  showSchools: false,
  showHospitals: false,
  showPaOilgas: false,
  oilGasSpillsOnly: false,
  showAumMines: false,
  showDogrmUrbanArea: false,

  waterSourcesLoaded: false,
  hydrographyLoaded: false,
  plumesLoaded: false,
  parcelsLoading: false,
  spillsLoaded: false,
  schoolsLoaded: false,
  hospitalsLoaded: false,
  odnrHazardsLoaded: false,

  hoverInfo: null,
  loadStatus: 'Loading critical wells…',

  toggleActivity: (level) =>
    set((s) => {
      const next = new Set(s.activityFilters);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return { activityFilters: next };
    }),
  resetActivity: () => set({ activityFilters: new Set<ActivityLevel>(ACTIVITY_LEVELS) }),

  setColorMode: (mode) => set({ colorMode: mode }),

  toggleRsFlag: (flag) =>
    set((s) => {
      const next = new Set(s.rsFlags);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return { rsFlags: next };
    }),
  clearRsFlags: () => set({ rsFlags: new Set<RsFlag>(), orphansOnly: false }),

  toggleOrphansOnly: () => set((s) => ({ orphansOnly: !s.orphansOnly })),

  // Mirrors the toggleLandCover function inside WellMap.tsx — collapsing back
  // to the full set is equivalent to 'all' but 'all' also keeps wells with a
  // null land_cover visible, so the closing branch must reset to 'all'.
  toggleLandCover: (code) =>
    set((s) => {
      const next = new Set<LandCoverCode>(
        s.landCoverFilter === 'all' ? LAND_COVER_CODES : s.landCoverFilter,
      );
      if (next.has(code)) next.delete(code);
      else next.add(code);
      if (next.size === LAND_COVER_CODES.length) return { landCoverFilter: 'all' };
      return { landCoverFilter: next };
    }),
  resetLandCover: () => set({ landCoverFilter: 'all' }),

  toggleHazardFlag: (flag) =>
    set((s) => {
      const next = new Set(s.hazardFlags);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return { hazardFlags: next };
    }),
  clearHazardFlags: () => set({
    hazardFlags: new Set<HazardFlag>(),
    aumOpeningDistance: 'any',
    triDistance: 'any',
  }),
  setAumOpeningDistance: (level) => set({ aumOpeningDistance: level }),
  setTriDistance:        (level) => set({ triDistance: level }),

  setWellsTab: (tab) => set({ wellsTab: tab }),

  cycleSatellite: () =>
    set((s) => {
      const i = SATELLITE_CYCLE.indexOf(s.satellite);
      const next = SATELLITE_CYCLE[(i + 1) % SATELLITE_CYCLE.length];
      return { satellite: next };
    }),

  setCountyMetric: (metric) => set({ countyMetric: metric }),

  toggleShowCounties: () => set((s) => ({ showCounties: !s.showCounties })),
  toggleShowWaterSources: () => set((s) => ({ showWaterSources: !s.showWaterSources })),
  toggleShowHydrography: () => set((s) => ({ showHydrography: !s.showHydrography })),
  toggleShowPlumes: () => set((s) => ({ showPlumes: !s.showPlumes })),
  toggleShowParcels: () => set((s) => ({ showParcels: !s.showParcels })),
  toggleShowSpills: () => set((s) => ({ showSpills: !s.showSpills })),
  toggleShowSchools: () => set((s) => ({ showSchools: !s.showSchools })),
  toggleShowHospitals: () => set((s) => ({ showHospitals: !s.showHospitals })),
  toggleShowPaOilgas: () => set((s) => ({ showPaOilgas: !s.showPaOilgas })),
  toggleShowAumMines:        () => set((s) => ({ showAumMines:        !s.showAumMines        })),
  toggleShowDogrmUrbanArea:  () => set((s) => ({ showDogrmUrbanArea:  !s.showDogrmUrbanArea  })),
  setOdnrHazardsLoaded:      (v) => set({ odnrHazardsLoaded: v }),
  // Flipping the oil/gas filter invalidates the cached source data (different
  // feature set), so spillsLoaded resets and the WellMap effect re-fetches.
  toggleOilGasSpillsOnly: () =>
    set((s) => ({ oilGasSpillsOnly: !s.oilGasSpillsOnly, spillsLoaded: false })),

  setWaterSourcesLoaded: (v) => set({ waterSourcesLoaded: v }),
  setHydrographyLoaded: (v) => set({ hydrographyLoaded: v }),
  setPlumesLoaded: (v) => set({ plumesLoaded: v }),
  setParcelsLoading: (v) => set({ parcelsLoading: v }),
  setSpillsLoaded: (v) => set({ spillsLoaded: v }),
  setSchoolsLoaded: (v) => set({ schoolsLoaded: v }),
  setHospitalsLoaded: (v) => set({ hospitalsLoaded: v }),

  setHoverInfo: (info) => set({ hoverInfo: info }),
  setLoadStatus: (status) => set({ loadStatus: status }),
}));
