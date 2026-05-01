import { PRIORITY_COLOR } from '@/lib/types';
import { useMapStore } from '@/lib/mapStore';
import { COLOR_MODE_LABEL } from '@/lib/mapExpressions';

export default function HoverTooltip() {
  const hoverInfo = useMapStore((s) => s.hoverInfo);
  const colorMode = useMapStore((s) => s.colorMode);
  if (!hoverInfo) return null;

  const rsScore =
    colorMode === 'emissions' ? hoverInfo.emissions_risk_score
    : colorMode === 'vegetation' ? hoverInfo.vegetation_risk_score
    : colorMode === 'terrain' ? hoverInfo.terrain_risk_score
    : null;

  return (
    <div
      className="absolute pointer-events-none z-20 bg-gray-900/95 border border-gray-600 rounded px-3 py-2 text-xs shadow-lg"
      style={{ left: hoverInfo.x + 12, top: hoverInfo.y - 14 }}
    >
      <div className="font-mono text-gray-300 mb-1">{hoverInfo.api_no}</div>
      <div className="flex items-center gap-2 mb-1">
        <span
          style={{
            color: PRIORITY_COLOR[hoverInfo.priority],
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {hoverInfo.priority}
        </span>
        {hoverInfo.risk_score != null && (
          <span className="text-gray-400 font-mono">{hoverInfo.risk_score.toFixed(1)}</span>
        )}
      </div>
      {colorMode !== 'priority' && (
        <div className="text-gray-400 mb-0.5">
          {COLOR_MODE_LABEL[colorMode]}:{' '}
          <span className="text-white font-mono">{rsScore != null ? rsScore.toFixed(0) : '—'}</span>
        </div>
      )}
      <div className="text-gray-400">{hoverInfo.county}</div>
    </div>
  );
}
