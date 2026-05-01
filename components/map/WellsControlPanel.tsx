import {
  PRIORITY_COLOR,
  LAND_COVER_LABEL,
  LAND_COVER_COLOR,
  type Priority,
} from '@/lib/types';
import { useMapStore } from '@/lib/mapStore';
import {
  ACTIVITY_COLOR,
  ACTIVITY_HINT,
  ACTIVITY_LABEL,
  ACTIVITY_LEVELS,
  COLOR_MODE_LABEL,
  LAND_COVER_CODES,
  PRIORITY_ORDER,
  RS_FLAG_COLOR,
  RS_FLAG_LABEL,
  WELLS_TABS,
  type ColorMode,
  type RsFlag,
} from '@/lib/mapExpressions';

interface Props {
  filters: Priority[];
  onFilterChange: (p: Priority) => void;
}

// Five-tab card: Priority / Activity / Color / Flags / Land. The dirty-dot
// in tab labels marks tabs whose state has drifted from default so the user
// can see, at a glance, that a hidden filter is active.
export default function WellsControlPanel({ filters, onFilterChange }: Props) {
  const wellsTab = useMapStore((s) => s.wellsTab);
  const setWellsTab = useMapStore((s) => s.setWellsTab);
  const activityFilters = useMapStore((s) => s.activityFilters);
  const toggleActivity = useMapStore((s) => s.toggleActivity);
  const resetActivity = useMapStore((s) => s.resetActivity);
  const colorMode = useMapStore((s) => s.colorMode);
  const setColorMode = useMapStore((s) => s.setColorMode);
  const rsFlags = useMapStore((s) => s.rsFlags);
  const toggleRsFlag = useMapStore((s) => s.toggleRsFlag);
  const clearRsFlags = useMapStore((s) => s.clearRsFlags);
  const orphansOnly = useMapStore((s) => s.orphansOnly);
  const toggleOrphansOnly = useMapStore((s) => s.toggleOrphansOnly);
  const landCoverFilter = useMapStore((s) => s.landCoverFilter);
  const toggleLandCover = useMapStore((s) => s.toggleLandCover);
  const resetLandCover = useMapStore((s) => s.resetLandCover);

  return (
    <div className="flex flex-col gap-1 bg-black/70 rounded p-2 border border-white/10 w-56">
      <div className="flex gap-0.5 mb-1 bg-black/60 rounded p-0.5">
        {WELLS_TABS.map((t) => {
          const active = wellsTab === t.key;
          const dirty =
            (t.key === 'priority' && filters.length < PRIORITY_ORDER.length) ||
            (t.key === 'activity' && activityFilters.size < ACTIVITY_LEVELS.length) ||
            (t.key === 'color'    && colorMode !== 'priority') ||
            (t.key === 'flags'    && (rsFlags.size > 0 || orphansOnly)) ||
            (t.key === 'land'     && landCoverFilter !== 'all');
          return (
            <button
              key={t.key}
              onClick={() => setWellsTab(t.key)}
              className="relative flex-1 min-w-0 px-1 py-1 rounded text-[10px] font-semibold capitalize transition-colors truncate"
              style={{
                backgroundColor: active ? '#fff' : 'transparent',
                color: active ? '#000' : '#9ca3af',
              }}
            >
              {t.label}
              {dirty && !active && (
                <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-orange-400" />
              )}
            </button>
          );
        })}
      </div>

      {wellsTab === 'priority' && (
        <div className="flex flex-col gap-1">
          {PRIORITY_ORDER.map((p) => {
            const active = filters.includes(p);
            return (
              <button
                key={p}
                onClick={() => onFilterChange(p)}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                style={{
                  backgroundColor: active ? PRIORITY_COLOR[p] : 'transparent',
                  color: active ? '#000' : PRIORITY_COLOR[p],
                  border: `1px solid ${PRIORITY_COLOR[p]}`,
                  opacity: active ? 1 : 0.5,
                }}
              >
                <span className="capitalize">{p}</span>
              </button>
            );
          })}
        </div>
      )}

      {wellsTab === 'activity' && (
        <div className="flex flex-col gap-1">
          {activityFilters.size < ACTIVITY_LEVELS.length && (
            <button
              onClick={resetActivity}
              className="self-end text-[10px] text-gray-400 hover:text-white -mb-0.5"
              title="Reset activity filter"
            >
              reset
            </button>
          )}
          {ACTIVITY_LEVELS.map((a) => {
            const active = activityFilters.has(a);
            const color = ACTIVITY_COLOR[a];
            return (
              <button
                key={a}
                onClick={() => toggleActivity(a)}
                title={ACTIVITY_HINT[a]}
                className="px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                style={{
                  backgroundColor: active ? color : 'transparent',
                  color: active ? '#000' : color,
                  border: `1px solid ${color}`,
                  opacity: active ? 1 : 0.5,
                }}
              >
                {ACTIVITY_LABEL[a]}
              </button>
            );
          })}
          <p className="text-[10px] text-gray-500 mt-1 leading-tight">
            Filters by production recency. Hover a chip for the rule.
          </p>
        </div>
      )}

      {wellsTab === 'color' && (
        <div className="flex flex-col gap-1">
          {(Object.keys(COLOR_MODE_LABEL) as ColorMode[]).map((mode) => {
            const active = colorMode === mode;
            const swatch = mode === 'priority' ? PRIORITY_COLOR.critical : '#ef4444';
            return (
              <button
                key={mode}
                onClick={() => setColorMode(mode)}
                className="px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                style={{
                  backgroundColor: active ? swatch : 'transparent',
                  color: active ? '#000' : swatch,
                  border: `1px solid ${swatch}`,
                  opacity: active ? 1 : 0.5,
                }}
              >
                {COLOR_MODE_LABEL[mode]}
              </button>
            );
          })}
          {colorMode !== 'priority' && (
            <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
              <span>0</span>
              <div
                className="flex-1 h-1.5 rounded"
                style={{
                  background:
                    'linear-gradient(to right, #1e3a5f, #2563eb, #f97316, #ef4444, #7f1d1d)',
                }}
              />
              <span>100</span>
            </div>
          )}
        </div>
      )}

      {wellsTab === 'flags' && (
        <div className="flex flex-col gap-1">
          {(rsFlags.size > 0 || orphansOnly) && (
            <button
              onClick={clearRsFlags}
              className="self-end text-[10px] text-gray-400 hover:text-white -mb-0.5"
              title="Clear all flag filters"
            >
              clear
            </button>
          )}
          {(Object.keys(RS_FLAG_LABEL) as RsFlag[]).map((flag) => {
            const active = rsFlags.has(flag);
            const color = RS_FLAG_COLOR[flag];
            return (
              <button
                key={flag}
                onClick={() => toggleRsFlag(flag)}
                className="px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
                style={{
                  backgroundColor: active ? color : 'transparent',
                  color: active ? '#000' : color,
                  border: `1px solid ${color}`,
                  opacity: active ? 1 : 0.5,
                }}
              >
                {RS_FLAG_LABEL[flag]}
              </button>
            );
          })}
          {rsFlags.has('veg') && (
            <p className="text-[10px] text-gray-500 mt-1 leading-tight">
              Surface-anomaly run is partial — ~5K of 131K wells analyzed.
            </p>
          )}
          {rsFlags.size > 0 && filters.includes('critical') && (
            <p className="text-[10px] text-red-400 mt-1 leading-tight">
              Critical wells stay visible regardless of flag filters.
            </p>
          )}

          {/* Hard filter — visually separated from RS flags since it's a
              status filter (not a remote-sensing signal) and AND's onto
              every priority tier including critical. */}
          <div className="border-t border-white/10 mt-1 pt-1.5">
            <button
              onClick={toggleOrphansOnly}
              className="w-full flex items-center justify-between px-2 py-1 rounded text-xs font-medium transition-opacity text-left"
              style={{
                backgroundColor: orphansOnly ? '#fb7185' : 'transparent',
                color: orphansOnly ? '#000' : '#fb7185',
                border: '1px solid #fb7185',
                opacity: orphansOnly ? 1 : 0.5,
              }}
              title="Keep only wells whose operator_status is historic_owner or orphan_program (~50K of 131K)"
            >
              <span>Orphans only</span>
              <span className="text-[10px] opacity-70">{orphansOnly ? '50K' : ''}</span>
            </button>
          </div>
        </div>
      )}

      {wellsTab === 'land' && (
        <div className="flex flex-col gap-1">
          {landCoverFilter !== 'all' && (
            <button
              onClick={resetLandCover}
              className="self-end text-[10px] text-gray-400 hover:text-white -mb-0.5"
              title="Show all land-cover classes"
            >
              reset
            </button>
          )}
          <div className="grid grid-cols-2 gap-1">
            {LAND_COVER_CODES.map((code) => {
              const active = landCoverFilter === 'all' || landCoverFilter.has(code);
              const color = LAND_COVER_COLOR[code];
              return (
                <button
                  key={code}
                  onClick={() => toggleLandCover(code)}
                  className="px-1.5 py-1 rounded text-[11px] font-medium transition-opacity text-left capitalize truncate"
                  style={{
                    backgroundColor: active ? color : 'transparent',
                    color: active ? '#000' : color,
                    border: `1px solid ${color}`,
                    opacity: active ? 1 : 0.5,
                  }}
                  title={LAND_COVER_LABEL[code]}
                >
                  {LAND_COVER_LABEL[code]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
