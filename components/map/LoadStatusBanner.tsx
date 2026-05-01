import { clearCachedWells } from '@/lib/wellsCache';
import { useMapStore } from '@/lib/mapStore';

export default function LoadStatusBanner() {
  const loadStatus = useMapStore((s) => s.loadStatus);

  return (
    <>
      {loadStatus && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-4 py-2 rounded-full">
          {loadStatus}
        </div>
      )}
      <button
        onClick={async () => {
          await clearCachedWells();
          window.location.reload();
        }}
        title="Clear local cache and re-fetch wells from Supabase"
        className="absolute bottom-2 right-2 z-20 bg-gray-900/80 hover:bg-gray-800 text-gray-400 hover:text-white text-[10px] px-2 py-1 rounded border border-gray-700"
      >
        ↻ Refresh data
      </button>
    </>
  );
}
