import type { BridgeJson } from "@nervekit/contracts/extensions";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { findExtensionPage } from "./extension-ui.svelte";
import { extensionPageTabId } from "../model/page-tab-id";

/** Opens (or focuses) the tab of one of the project's extension pages. */
export function openExtensionPage(
  projectId: string | undefined,
  extensionId: string,
  pageId: string,
  params?: BridgeJson,
): boolean {
  if (!findExtensionPage(projectId, extensionId, pageId)) return false;
  const tab = {
    kind: "extension-page" as const,
    id: extensionPageTabId(extensionId, pageId, params),
  };
  addCenterTab(tab);
  setActiveCenterTab(tab);
  return true;
}

export function selectCenterExtensionPageTab(id: string): void {
  const tab = { kind: "extension-page" as const, id };
  addCenterTab(tab);
  setActiveCenterTab(tab);
}

export function closeExtensionPageTab(id: string): void {
  const tab = { kind: "extension-page" as const, id };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "extension-page" &&
    workspaceState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  if (closingActive) void selectCenterTab(fallback);
}
