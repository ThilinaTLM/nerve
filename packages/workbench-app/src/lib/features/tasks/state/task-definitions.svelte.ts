import { SvelteMap } from "svelte/reactivity";
import { getTaskDefinitions, type TaskDefinition } from "$lib/api";

type FetchTaskDefinitions = (projectId: string) => Promise<TaskDefinition[]>;

export type TaskDefinitionStore = {
  cached: (projectId: string | undefined) => TaskDefinition[] | undefined;
  load: (projectId: string) => Promise<void>;
  upsert: (projectId: string, definition: TaskDefinition) => void;
  remove: (definitionId: string) => void;
};

/**
 * Creates a project-scoped reactive cache with non-reactive in-flight request
 * bookkeeping. The cache may outlive a panel while explicit loads revalidate
 * known data in the background.
 */
export function createTaskDefinitionStore(
  fetchDefinitions: FetchTaskDefinitions,
): TaskDefinitionStore {
  const byProject = new SvelteMap<string, TaskDefinition[]>();
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

const taskDefinitionStore = createTaskDefinitionStore(getTaskDefinitions);

export function cachedTaskDefinitions(
  projectId: string | undefined,
): TaskDefinition[] | undefined {
  return taskDefinitionStore.cached(projectId);
}

/** Revalidates one project while sharing any request already in flight. */
export function loadTaskDefinitions(projectId: string): Promise<void> {
  return taskDefinitionStore.load(projectId);
}

export function upsertCachedTaskDefinition(
  projectId: string,
  definition: TaskDefinition,
): void {
  taskDefinitionStore.upsert(projectId, definition);
}

export function removeCachedTaskDefinition(definitionId: string): void {
  taskDefinitionStore.remove(definitionId);
}
