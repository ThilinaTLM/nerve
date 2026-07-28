import { SvelteMap } from "svelte/reactivity";
import { getTaskDefinitions, type TaskDefinition } from "$lib/api";

/**
 * Project-scoped cache for task definitions. It outlives the tasks panel so
 * re-opening the panel renders the known definitions immediately and only
 * revalidates in the background.
 */
const byProject = new SvelteMap<string, TaskDefinition[]>();
// Request de-duplication only; deliberately non-reactive.
const inFlight = new SvelteMap<string, Promise<void>>();

export function cachedTaskDefinitions(
  projectId: string | undefined,
): TaskDefinition[] | undefined {
  return projectId ? byProject.get(projectId) : undefined;
}

/** Fetches definitions once per project, reusing an in-flight request. */
export async function loadTaskDefinitions(projectId: string): Promise<void> {
  const pending = inFlight.get(projectId);
  if (pending) return pending;
  const request = getTaskDefinitions(projectId)
    .then((definitions) => {
      byProject.set(projectId, definitions);
    })
    .finally(() => {
      inFlight.delete(projectId);
    });
  inFlight.set(projectId, request);
  return request;
}

export function upsertCachedTaskDefinition(
  projectId: string,
  definition: TaskDefinition,
): void {
  const current = byProject.get(projectId) ?? [];
  const index = current.findIndex((item) => item.id === definition.id);
  byProject.set(
    projectId,
    index === -1
      ? [...current, definition]
      : current.map((item) => (item.id === definition.id ? definition : item)),
  );
}

export function removeCachedTaskDefinition(definitionId: string): void {
  for (const [projectId, definitions] of byProject) {
    if (!definitions.some((item) => item.id === definitionId)) continue;
    byProject.set(
      projectId,
      definitions.filter((item) => item.id !== definitionId),
    );
  }
}
