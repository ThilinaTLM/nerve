import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { discoverEditorialCatalog } from "./catalog.js";
import {
  buildDiscoverSections,
  discoverAttentionCount,
  resolveDiscoverEditorial,
  shouldOpenDiscoverOnStartup,
  unseenEditorialCount,
} from "./policy.js";
import {
  markEditorialSeen,
  readDiscoverSeenVersions,
  writeDiscoverSeenVersions,
  type DiscoverSeenVersions,
} from "./progress.js";
import { openDiscoverPane } from "./tabs.svelte.js";
import {
  catalogGuides,
  incompleteGuideCount,
  reconcileComputedGuideCompletion,
} from "./guides/state.svelte.js";

export const discoverState = $state({
  consideredGeneration: undefined as number | undefined,
  seenVersions: readDiscoverSeenVersions() as DiscoverSeenVersions,
});

export function resolvedDiscoverEditorial() {
  return resolveDiscoverEditorial(
    discoverEditorialCatalog,
    discoverState.seenVersions,
  );
}

export function discoverSections() {
  return buildDiscoverSections(catalogGuides(), resolvedDiscoverEditorial());
}

export function discoverUnseenCount(): number {
  return unseenEditorialCount(resolvedDiscoverEditorial());
}

export function discoverTitlebarCount(): number {
  return discoverAttentionCount({
    incompleteGuideCount: incompleteGuideCount(),
    unseenEditorialCount: discoverUnseenCount(),
  });
}

export function markDiscoverSeen(): void {
  const next = markEditorialSeen(discoverState.seenVersions);
  if (next === discoverState.seenVersions) return;
  discoverState.seenVersions = next;
  writeDiscoverSeenVersions(next);
}

export function considerAutomaticDiscover(): void {
  if (!workbenchStartupState.progressiveActive || !settingsState.settingsDraft)
    return;
  reconcileComputedGuideCompletion();
  const generation = workbenchStartupState.generation;
  if (
    !shouldOpenDiscoverOnStartup({
      progressiveActive: workbenchStartupState.progressiveActive,
      settingsLoaded: Boolean(settingsState.settingsDraft),
      generation,
      consideredGeneration: discoverState.consideredGeneration,
    })
  )
    return;
  discoverState.consideredGeneration = generation;
  openDiscoverPane();
}
