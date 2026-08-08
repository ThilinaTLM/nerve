import { getProviderCatalog } from "$lib/api";
import { loadSettingsPanel } from "$lib/features/settings/state/settings-actions.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { authState } from "./auth-state.svelte";

const AUTH_TAB = { kind: "auth" as const, id: "auth" as const };

function targetAuthPage(pageId?: string, sectionId?: string): void {
  if (pageId) authState.activePageId = pageId;
  if (sectionId) authState.activeSectionId = sectionId;
}

export async function openAuthPane(
  pageId?: string,
  sectionId?: string,
): Promise<void> {
  targetAuthPage(pageId, sectionId);
  addCenterTab(AUTH_TAB);
  setActiveCenterTab(AUTH_TAB);
  await loadAuthPanel();
}

export function selectCenterAuthTab(pageId?: string, sectionId?: string) {
  targetAuthPage(pageId, sectionId);
  addCenterTab(AUTH_TAB);
  setActiveCenterTab(AUTH_TAB);
  if (!authState.catalogLoaded) void loadAuthPanel();
}

export function closeAuthTab() {
  const closingActive = workspaceState.activeCenterTab?.kind === "auth";
  const fallback = nextCenterTabAfterClose(AUTH_TAB);
  removeCenterTab(AUTH_TAB);
  if (closingActive) void selectCenterTab(fallback);
}

/** Load the provider catalog and refresh shared provider/model state. */
export async function loadAuthPanel() {
  const [catalog] = await Promise.all([
    getProviderCatalog(),
    loadSettingsPanel(),
  ]);
  authState.customProviders = catalog.providers;
  authState.modelDefinitions = catalog.models;
  authState.catalogLoaded = true;
}

/** Refresh only the catalog (after a mutation); also refreshes providers. */
export async function refreshProviderCatalog() {
  const catalog = await getProviderCatalog();
  authState.customProviders = catalog.providers;
  authState.modelDefinitions = catalog.models;
  authState.catalogLoaded = true;
  await loadSettingsPanel();
}
