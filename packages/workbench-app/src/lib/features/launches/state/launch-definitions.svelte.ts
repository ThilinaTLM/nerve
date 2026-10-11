import { onWorkbenchReconnect } from "$lib/application/events/workbench-event-bus";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { getLaunchDefinitions, type LaunchDefinition } from "$lib/api";

type FetchLaunchDefinitions = (
  projectId: string,
) => Promise<LaunchDefinition[]>;

export type LaunchDefinitionStore = {
  cached: (projectId: string | undefined) => LaunchDefinition[] | undefined;
  load: (projectId: string) => Promise<void>;
  upsert: (projectId: string, definition: LaunchDefinition) => void;
  remove: (definitionId: string) => void;
};

/**
 * Creates a project-scoped reactive cache with non-reactive in-flight request
 * bookkeeping. The cache may outlive a panel while explicit loads revalidate
 * known data in the background.
 */
export function createLaunchDefinitionStore(
  fetchDefinitions: FetchLaunchDefinitions,
): LaunchDefinitionStore {
  const byProject = new SvelteMap<string, LaunchDefinition[]>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- request bookkeeping must not invalidate rune effects.
  const inFlight = new Map<string, Promise<void>>();

  return {
    cached(projectId) {
      return projectId ? byProject.get(projectId) : undefined;
    },
    async load(projectId) {
      const pending = inFlight.get(projectId);
      if (pending) return pending;
      const request = fetchDefinitions(projectId)
        .then((definitions) => {
          byProject.set(projectId, definitions);
        })
        .finally(() => {
          inFlight.delete(projectId);
        });
      inFlight.set(projectId, request);
      return request;
    },
    upsert(projectId, definition) {
      const current = byProject.get(projectId) ?? [];
      const index = current.findIndex((item) => item.id === definition.id);
      byProject.set(
        projectId,
        index === -1
          ? [...current, definition]
          : current.map((item) =>
              item.id === definition.id ? definition : item,
            ),
      );
    },
    remove(definitionId) {
      for (const [projectId, definitions] of byProject) {
        if (!definitions.some((item) => item.id === definitionId)) continue;
        byProject.set(
          projectId,
          definitions.filter((item) => item.id !== definitionId),
        );
      }
    },
  };
}

const loadedProjects = new SvelteSet<string>();
const launchDefinitionStore = createLaunchDefinitionStore(getLaunchDefinitions);
onWorkbenchReconnect(async () => {
  await Promise.all(
    [...loadedProjects].map((projectId) =>
      launchDefinitionStore.load(projectId),
    ),
  );
});

export function cachedLaunchDefinitions(
  projectId: string | undefined,
): LaunchDefinition[] | undefined {
  return launchDefinitionStore.cached(projectId);
}

/** Revalidates one project while sharing any request already in flight. */
export function loadLaunchDefinitions(projectId: string): Promise<void> {
  loadedProjects.add(projectId);
  return launchDefinitionStore.load(projectId);
}

export function upsertCachedLaunchDefinition(
  projectId: string,
  definition: LaunchDefinition,
): void {
  launchDefinitionStore.upsert(projectId, definition);
}

export function removeCachedLaunchDefinition(definitionId: string): void {
  launchDefinitionStore.remove(definitionId);
}
