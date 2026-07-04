import { LruCache } from "@nervekit/ui/core/utils/lru-cache";

/**
 * A persisted row-height store for a single virtual list scope (e.g. one
 * conversation). Maps a stable item key to the last measured row height.
 */
export type RowHeightCache = {
  get(key: string | number): number | undefined;
  set(key: string | number, height: number): void;
  readonly size: number;
};

// Heights for a given item key are stable across mounts (committed row keys
// encode content identity). Seeding `estimateSize` from this cache lets a
// remounted virtual list paint rows at their real height immediately — no
// synchronous `offsetHeight` reflow, no overlap flash, no immediate
// re-measure. Bounded by the number of distinct scopes so switching across
// many conversations doesn't grow without limit; per-scope row maps are
// bounded by transcript length.
const scopes = new LruCache<string, Map<string | number, number>>(12);

/**
 * Resolve (or lazily create) the persisted height cache for a scope key.
 * The returned handle closes over a stable `Map` for the caller's lifetime.
 */
export function getRowHeightCache(scopeKey: string): RowHeightCache {
  let map = scopes.get(scopeKey);
  if (!map) {
    map = new Map<string | number, number>();
    scopes.set(scopeKey, map);
  }
  const rows = map;
  return {
    get: (key) => rows.get(key),
    set: (key, height) => {
      if (height > 0) rows.set(key, height);
    },
    get size() {
      return rows.size;
    },
  };
}

/** Drop all cached heights. Intended for tests. */
export function clearRowHeightCaches(): void {
  scopes.clear();
}
