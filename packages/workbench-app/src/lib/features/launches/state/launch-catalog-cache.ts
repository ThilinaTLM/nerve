import type { LaunchDefinitionCatalog } from "@nervekit/contracts/launch-definitions";

/** Opaque revisions are never ordered: generations fence every asynchronous read. */
export function createLaunchCatalogCache(
  fetchCatalog: (projectId: string) => Promise<LaunchDefinitionCatalog>,
  changed: () => void = () => {},
) {
  const snapshots = new Map<string, LaunchDefinitionCatalog>();
  const errors = new Map<string, string>();
  const generations = new Map<string, number>();
  const pending = new Map<string, Promise<void>>();
  const demanded = new Set<string>();
  function load(projectId: string): Promise<void> {
    demanded.add(projectId);
    const existing = pending.get(projectId);
    if (existing) return existing;
    const request = (async () => {
      // Defer fetch invocation until the pending slot exists (including sync throws).
      await Promise.resolve();
      try {
        for (;;) {
          const generation = generations.get(projectId) ?? 0;
          try {
            const catalog = await fetchCatalog(projectId);
            if (generation !== (generations.get(projectId) ?? 0)) continue;
            snapshots.set(projectId, catalog);
            errors.delete(projectId);
            changed();
            // Subscribers can invalidate synchronously from changed().
            if (generation !== (generations.get(projectId) ?? 0)) continue;
            return;
          } catch (error) {
            if (generation !== (generations.get(projectId) ?? 0)) continue;
            errors.set(
              projectId,
              error instanceof Error ? error.message : String(error),
            );
            changed();
            if (generation !== (generations.get(projectId) ?? 0)) continue;
            throw error;
          }
        }
      } finally {
        // Clear before settling, not in a later promise reaction: an invalidation
        // after the final generation check must start a new awaited request.
        pending.delete(projectId);
      }
    })();
    pending.set(projectId, request);
    return request;
  }
  function invalidate(projectId: string): Promise<void> {
    generations.set(projectId, (generations.get(projectId) ?? 0) + 1);
    return load(projectId);
  }
  return {
    cached: (projectId: string | undefined) =>
      projectId ? snapshots.get(projectId) : undefined,
    error: (projectId: string | undefined) =>
      projectId ? errors.get(projectId) : undefined,
    load,
    invalidate,
    revalidate: () => Promise.all([...demanded].map(invalidate)).then(() => {}),
  };
}
