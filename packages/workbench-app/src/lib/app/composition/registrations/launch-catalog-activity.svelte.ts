import { untrack } from "svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { launchSelectors } from "$lib/features/launches/state/launch-selectors.svelte";
import {
  cachedLaunchCatalog,
  loadLaunchDefinitions,
} from "$lib/features/launches/state/launch-definitions.svelte";
import { launchActivity } from "$lib/features/launches/views/launch-panel-controller";

/** Owned by the application, not the movable/unmounted launches panel. */
export function createLaunchCatalogActivity() {
  $effect(() => {
    if (!workbenchStartupState.progressiveActive) return;
    const projectId = workspaceSelectors.activeProject?.id;
    if (projectId)
      untrack(() => {
        void loadLaunchDefinitions(projectId).catch(() => {});
      });
  });
  return {
    get count() {
      const catalog = cachedLaunchCatalog(workspaceSelectors.activeProject?.id);
      return catalog
        ? launchActivity(
            catalog.definitions,
            catalog.folders,
            launchSelectors.launches,
          ).activeDefinitionCount
        : 0;
    },
  };
}
