import { PRIORITY_COLOR, type CountySummary } from '@/lib/types';
import { useMapStore } from '@/lib/mapStore';
import { COUNTY_METRIC_LABELS, HAZARD_FLAG_COLOR, type CountyMetric } from '@/lib/mapExpressions';

const PARCELS_PMTILES_URL = process.env.NEXT_PUBLIC_PARCELS_PMTILES_URL;
const PARCELS_USE_PMTILES = !!PARCELS_PMTILES_URL;

interface Props {
  selectedCounty: CountySummary | null;
}

// Overlay toggle list. The county metric picker only appears when counties
// are visible — picking a different metric while the layer is hidden has no
// affordance.
export default function LayersPanel({ selectedCounty }: Props) {
  const showCounties = useMapStore((s) => s.showCounties);
  const toggleShowCounties = useMapStore((s) => s.toggleShowCounties);
  const countyMetric = useMapStore((s) => s.countyMetric);
  const setCountyMetric = useMapStore((s) => s.setCountyMetric);

  const showHydrography = useMapStore((s) => s.showHydrography);
  const toggleShowHydrography = useMapStore((s) => s.toggleShowHydrography);
  const hydrographyLoaded = useMapStore((s) => s.hydrographyLoaded);

  const showPlumes = useMapStore((s) => s.showPlumes);
  const toggleShowPlumes = useMapStore((s) => s.toggleShowPlumes);
  const plumesLoaded = useMapStore((s) => s.plumesLoaded);

  const showParcels = useMapStore((s) => s.showParcels);
  const toggleShowParcels = useMapStore((s) => s.toggleShowParcels);
  const parcelsLoading = useMapStore((s) => s.parcelsLoading);

  const showSpills = useMapStore((s) => s.showSpills);
  const toggleShowSpills = useMapStore((s) => s.toggleShowSpills);
  const oilGasSpillsOnly = useMapStore((s) => s.oilGasSpillsOnly);
  const toggleOilGasSpillsOnly = useMapStore((s) => s.toggleOilGasSpillsOnly);
  const spillsLoaded = useMapStore((s) => s.spillsLoaded);

  const showSchools = useMapStore((s) => s.showSchools);
  const toggleShowSchools = useMapStore((s) => s.toggleShowSchools);
  const schoolsLoaded = useMapStore((s) => s.schoolsLoaded);

  const showPaOilgas = useMapStore((s) => s.showPaOilgas);
  const toggleShowPaOilgas = useMapStore((s) => s.toggleShowPaOilgas);

  const showHospitals = useMapStore((s) => s.showHospitals);
  const toggleShowHospitals = useMapStore((s) => s.toggleShowHospitals);
  const hospitalsLoaded = useMapStore((s) => s.hospitalsLoaded);

  const showAumMines           = useMapStore((s) => s.showAumMines);
  const toggleShowAumMines     = useMapStore((s) => s.toggleShowAumMines);
  const showDogrmUrbanArea     = useMapStore((s) => s.showDogrmUrbanArea);
  const toggleShowDogrmUrbanArea = useMapStore((s) => s.toggleShowDogrmUrbanArea);
  const odnrHazardsLoaded      = useMapStore((s) => s.odnrHazardsLoaded);
  const anyHazardOn = showAumMines || showDogrmUrbanArea;

  return (
    <div className="flex flex-col bg-black/70 rounded p-2 border border-white/10 w-56">
      <span className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Layers</span>

      <button
        onClick={toggleShowCounties}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showCounties ? '#a78bfa' : '#9ca3af' }}
      >
        <span>Counties</span>
        <span>{showCounties ? '●' : '○'}</span>
      </button>
      {showCounties && (
        <div className="grid grid-cols-2 gap-1 mt-1 mb-2">
          {(Object.keys(COUNTY_METRIC_LABELS) as CountyMetric[]).map((m) => {
            const active = countyMetric === m;
            const color =
              m === 'avg_risk_score'  ? '#a78bfa' :
              m === 'critical_count'  ? PRIORITY_COLOR.critical :
              m === 'high_count'      ? PRIORITY_COLOR.high :
              m === 'medium_count'    ? PRIORITY_COLOR.medium :
              m === 'annual_co2e_mt'  ? '#f59e0b' :
              PRIORITY_COLOR.low;
            return (
              <button
                key={m}
                onClick={() => setCountyMetric(m)}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-opacity text-left truncate"
                style={{
                  backgroundColor: active ? color : 'transparent',
                  color: active ? '#000' : color,
                  border: `1px solid ${color}`,
                  opacity: active ? 1 : 0.5,
                }}
              >
                {COUNTY_METRIC_LABELS[m]}
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={toggleShowHydrography}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showHydrography ? '#60a5fa' : '#9ca3af' }}
      >
        <span>Rivers &amp; lakes</span>
        <span>{showHydrography ? '●' : '○'}</span>
      </button>
      {showHydrography && !hydrographyLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
      )}
      {showHydrography && hydrographyLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          USGS NHD · click for name
        </p>
      )}

      <button
        onClick={toggleShowPlumes}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showPlumes ? '#f59e0b' : '#9ca3af' }}
      >
        <span>CH₄ plumes</span>
        <span>{showPlumes ? '●' : '○'}</span>
      </button>
      {showPlumes && !plumesLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
      )}
      {showPlumes && plumesLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          Dot size = flux (log scale)
        </p>
      )}

      <button
        onClick={toggleShowParcels}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showParcels ? '#84cc16' : '#9ca3af' }}
      >
        <span>Surface parcels</span>
        <span>{showParcels ? '●' : '○'}</span>
      </button>
      {showParcels && parcelsLoading && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
      )}
      {showParcels && !parcelsLoading && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          {PARCELS_USE_PMTILES
            ? (selectedCounty?.county
                ? `Filtered to ${selectedCounty.county}`
                : 'Green = state land · colored by land use')
            : (selectedCounty?.county
                ? `Showing ${selectedCounty.county}`
                : 'Click a county or zoom in')}
        </p>
      )}

      <button
        onClick={toggleShowSpills}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showSpills ? '#dc2626' : '#9ca3af' }}
      >
        <span>OEPA spills</span>
        <span>{showSpills ? '●' : '○'}</span>
      </button>
      {showSpills && (
        <button
          onClick={toggleOilGasSpillsOnly}
          className="flex items-center justify-between text-[10px] py-0.5 pl-3"
          style={{ color: oilGasSpillsOnly ? '#dc2626' : '#6b7280' }}
        >
          <span>Oil/gas only</span>
          <span>{oilGasSpillsOnly ? '☑' : '☐'}</span>
        </button>
      )}
      {showSpills && !spillsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
      )}
      {showSpills && spillsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          Red = oil/gas · amber = other · click for case detail
        </p>
      )}

      <button
        onClick={toggleShowSchools}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showSchools ? '#a855f7' : '#9ca3af' }}
      >
        <span>Public schools</span>
        <span>{showSchools ? '●' : '○'}</span>
      </button>
      {showSchools && !schoolsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
      )}
      {showSchools && schoolsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          ODE 2021-2022 · click for school detail
        </p>
      )}

      <button
        onClick={toggleShowHospitals}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showHospitals ? '#ec4899' : '#9ca3af' }}
      >
        <span>Hospitals</span>
        <span>{showHospitals ? '●' : '○'}</span>
      </button>
      {showHospitals && !hospitalsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading…</p>
      )}
      {showHospitals && hospitalsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          ODH 2023 · 230 geocoded · click for detail
        </p>
      )}

      {/* ── ODNR hazards subgroup ─────────────────────────────────────── */}
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-2 mb-0.5">
        ODNR hazards
      </div>

      <button
        onClick={toggleShowAumMines}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showAumMines ? HAZARD_FLAG_COLOR.aum_subsidence : '#9ca3af' }}
      >
        <span>Mine subsidence</span>
        <span>{showAumMines ? '●' : '○'}</span>
      </button>

      <button
        onClick={toggleShowDogrmUrbanArea}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showDogrmUrbanArea ? HAZARD_FLAG_COLOR.dogrm_urban : '#9ca3af' }}
      >
        <span>DOGRM urban</span>
        <span>{showDogrmUrbanArea ? '●' : '○'}</span>
      </button>

      {anyHazardOn && !odnrHazardsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5">Loading ODNR layers…</p>
      )}
      {anyHazardOn && odnrHazardsLoaded && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          gis.ohiodnr.gov · click for name &amp; area
        </p>
      )}

      <button
        onClick={toggleShowPaOilgas}
        className="flex items-center justify-between text-xs py-0.5"
        style={{ color: showPaOilgas ? '#10b981' : '#9ca3af' }}
      >
        <span>PA oil &amp; gas wells</span>
        <span>{showPaOilgas ? '●' : '○'}</span>
      </button>
      {showPaOilgas && (
        <p className="text-[10px] text-gray-500 pl-1 -mt-0.5 leading-tight">
          PA DEP 2026-04 · 224K wells · click for permit detail
        </p>
      )}
    </div>
  );
}
