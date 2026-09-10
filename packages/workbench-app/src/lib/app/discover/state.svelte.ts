import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { releaseSelectors } from "$lib/features/releases";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { discoverNewsCatalog } from "./content/news.js";
import { discoverTipsCatalog } from "./content/tips.js";
import {
  buildDiscoverSections,
  countAutoOpen,
  decideDiscoverAutoOpen,
  discoverBadge,
  exhaustAutoOpen,
  resolveNews,
  unreadNewsCount,
  type DiscoverBadge,
  type DiscoverSections,
} from "./policy.js";
import {
  defaultDiscoverProgress,
  markAllSeen,
  readDiscoverProgress,
  writeDiscoverProgress,
  type DiscoverProgress,
} from "./progress.js";
import { openDiscoverPane } from "./tabs.svelte.js";
import {
  catalogGuides,
  reconcileComputedGuideCompletion,
} from "./guides/state.svelte.js";

const stored = readDiscoverProgress();

export const discoverState = $state({
  consideredGeneration: undefined as number | undefined,
  firstRun: stored === undefined,
  progress: (stored ?? {
    seen: { ...defaultDiscoverProgress.seen },
    autoOpen: { ...defaultDiscoverProgress.autoOpen },
  }) as DiscoverProgress,
});

function appVersion(): string | undefined {
  return workspaceState.status?.version;
}

function persist(progress: DiscoverProgress): void {
  discoverState.progress = progress;
  discoverState.firstRun = false;
  writeDiscoverProgress(progress);
}

function resolvedNews() {
  return resolveNews(discoverNewsCatalog, discoverState.progress.seen);
}

export function discoverSections(): DiscoverSections {
  return buildDiscoverSections({
    guides: catalogGuides(),
    news: resolvedNews(),
    tips: discoverTipsCatalog,
    appVersion: appVersion(),
  });
}

export type DiscoverPageModel = {
  sections: DiscoverSections;
  currentVersion: string | undefined;
  latestVersion: string | undefined;
  latestReleaseUrl: string | undefined;
  autoOpenEnabled: boolean;
  unreadCount: number;
};

export function discoverPageModel(): DiscoverPageModel {
  const sections = discoverSections();
  return {
    sections,
    currentVersion: appVersion(),
    latestVersion: releaseSelectors.latest?.version,
    latestReleaseUrl: releaseSelectors.latest?.releaseUrl,
    autoOpenEnabled: discoverState.progress.autoOpen.enabled,
    unreadCount: sections.news.unreadCount,
  };
}

export function discoverTitlebarBadge(): DiscoverBadge {
  return discoverBadge({
    unreadNewsCount: unreadNewsCount(resolvedNews()),
    pendingSetupCount: discoverSections().setup.pending.length,
  });
}

/** Viewing Discover clears unread news and the remaining auto-open budget. */
export function markDiscoverSeen(): void {
  const seen = markAllSeen(discoverState.progress.seen);
  const autoOpen = exhaustAutoOpen(
    discoverState.progress.autoOpen,
    appVersion(),
  );
  if (
    seen === discoverState.progress.seen &&
    autoOpen === discoverState.progress.autoOpen &&
    !discoverState.firstRun
  )
    return;
  persist({ seen, autoOpen });
}

export function setDiscoverAutoOpen(enabled: boolean): void {
  if (discoverState.progress.autoOpen.enabled === enabled) return;
  persist({
    seen: discoverState.progress.seen,
    autoOpen: { ...discoverState.progress.autoOpen, enabled },
  });
}

export function considerAutomaticDiscover(): void {
  if (!workbenchStartupState.progressiveActive || !settingsState.settingsDraft)
    return;
  reconcileComputedGuideCompletion();
  const generation = workbenchStartupState.generation;
  const sections = discoverSections();
  const decision = decideDiscoverAutoOpen({
    ready: true,
    alreadyConsidered: discoverState.consideredGeneration === generation,
    firstRun: discoverState.firstRun,
    appVersion: appVersion(),
    unreadForCurrentVersion: [
      sections.news.featured,
      ...sections.news.current,
    ].filter((entry) => entry?.unread).length,
    autoOpen: discoverState.progress.autoOpen,
  });
  discoverState.consideredGeneration = generation;
  if (!decision.open) return;
  persist({
    seen: discoverState.progress.seen,
    autoOpen: countAutoOpen(discoverState.progress.autoOpen, appVersion()),
  });
  openDiscoverPane();
}
