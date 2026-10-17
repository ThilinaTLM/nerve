import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { getLaunchCatalog } from "$lib/features/launches/api/launches.api";
import { createLaunchCatalogCache } from "./launch-catalog-cache";

let version = $state(0);
const store = createLaunchCatalogCache(getLaunchCatalog, () => {
  version += 1;
});
// Registered at module/application lifetime, before any demanded initial read.
onEvent("launchCatalog.changed", (event) => {
  const projectId = event.data?.projectId;
  if (typeof projectId === "string")
    return store.invalidate(projectId).catch(() => {});
});
onWorkbenchReconnect(() => store.revalidate().catch(() => {}));
export function cachedLaunchCatalog(projectId: string | undefined) {
  void version;
  return store.cached(projectId);
}
export function launchCatalogError(projectId: string | undefined) {
  void version;
  return store.error(projectId);
}
export function cachedLaunchDefinitions(projectId: string | undefined) {
  return cachedLaunchCatalog(projectId)?.definitions;
}
export const loadLaunchDefinitions = store.invalidate;
export const invalidateLaunchCatalog = store.invalidate;
