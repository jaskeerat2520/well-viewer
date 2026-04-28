import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface CacheRec<T = unknown> {
  version: number;
  savedAt: number;
  value: T;
}

interface KvDB extends DBSchema {
  kv: {
    key: string;
    value: CacheRec;
  };
}

let dbPromise: Promise<IDBPDatabase<KvDB>> | null = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB<KvDB>('oh-well-viewer', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        // Cleanup of the old v1 store. Cast: the typed schema only knows about
        // 'kv', but we still need to handle pre-existing IDBs from before the
        // schema migration — `deleteObjectStore` is happy with any string name.
        const stores = db.objectStoreNames as unknown as DOMStringList;
        if (stores.contains('wells')) {
          (db as unknown as IDBDatabase).deleteObjectStore('wells');
        }
      },
      blocked() { console.warn('[idbCache] upgrade blocked by another open tab'); },
      blocking() {
        // Another tab wants to upgrade. Close our connection so it can.
        dbPromise?.then(d => d.close()).catch(() => {});
        dbPromise = null;
      },
    }).catch(err => { console.warn('[idbCache] openDB failed:', err); throw err; });
  }
  return dbPromise;
}

// Cache lookups should NEVER block the caller indefinitely. If openDB is
// blocked (e.g. an old tab holds a v1 connection) we'd otherwise hang the
// whole load path. 1.5s is plenty for a healthy IDB read on any device.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const memCache = new Map<string, CacheRec>();

export async function getCached<T>(key: string, version: number, ttlMs: number): Promise<T | null> {
  const fresh = (rec: CacheRec | undefined) =>
    !!rec && rec.version === version && (Date.now() - rec.savedAt) <= ttlMs;

  const mem = memCache.get(key);
  if (fresh(mem)) return mem!.value as T;
  if (mem) memCache.delete(key);

  if (typeof indexedDB === 'undefined') return null;

  return withTimeout((async () => {
    try {
      const rec = await (await db()).get('kv', key);
      if (!fresh(rec)) return null;
      memCache.set(key, rec!);
      return rec!.value as T;
    } catch {
      return null;
    }
  })(), 1500, null);
}

export async function setCached<T>(key: string, version: number, value: T): Promise<void> {
  const rec: CacheRec<T> = { version, savedAt: Date.now(), value };
  memCache.set(key, rec);
  if (typeof indexedDB === 'undefined') return;
  try {
    await (await db()).put('kv', rec, key);
  } catch {
    // Quota / private mode — silently fall back to in-memory only.
  }
}

export async function clearCached(key: string): Promise<void> {
  memCache.delete(key);
  if (typeof indexedDB === 'undefined') return;
  try { await (await db()).delete('kv', key); } catch {}
}

export async function clearCachedByPrefix(prefix: string): Promise<void> {
  for (const k of Array.from(memCache.keys())) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
  if (typeof indexedDB === 'undefined') return;
  try {
    const d = await db();
    const tx = d.transaction('kv', 'readwrite');
    const keys = await tx.store.getAllKeys();
    await Promise.all(keys.filter(k => String(k).startsWith(prefix)).map(k => tx.store.delete(k)));
    await tx.done;
  } catch {}
}
