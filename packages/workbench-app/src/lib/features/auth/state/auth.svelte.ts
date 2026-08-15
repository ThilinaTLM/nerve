import { getProviderCatalog } from "$lib/api";
import { loadSettingsPanel } from "$lib/features/settings/state/settings-actions.svelte";
import {
  addCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
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

export function disposeAuthTab(): void {}

function applyProviderCatalog(
  catalog: Awaited<ReturnType<typeof getProviderCatalog>>,
): void {
  authState.customProviders = catalog.providers;
  authState.modelDefinitions = catalog.models;
  authState.catalogLoaded = true;
}

/** Load the provider catalog and refresh shared provider/model state. */
export async function loadAuthPanel() {
  const [catalog] = await Promise.all([
    getProviderCatalog(),
    loadSettingsPanel(),
  ]);
  applyProviderCatalog(catalog);
}

/** Refresh only the catalog (after a mutation); also refreshes providers. */
export async function refreshProviderCatalog() {
  const catalog = await getProviderCatalog();
  applyProviderCatalog(catalog);
  await loadSettingsPanel();
}
