import { workspaceFeaturePorts } from "./workspace-feature-ports.svelte";
import type { CenterTabIdentity } from "$lib/application/workspace/workspace-state.svelte";
import {
  composerDraft,
  resetSelection,
  selection,
} from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  centerTabKey,
  centerTabsEqual,
  replaceOpenCenterTabs,
  selectCenterTab,
  setActiveCenterTab,
} from "./center-tabs.svelte";
import {
  isGlobalCenterTab,
  mostRecentRemainingTab,
  removeGlobalTabFromSessions,
} from "./workspace-tab-sessions";

function tabIndex(tab: CenterTabIdentity): number {
  return workspaceState.openCenterTabs.findIndex((candidate) =>
    centerTabsEqual(candidate, tab),
  );
}

function tabIsInList(
  tab: CenterTabIdentity | undefined,
  tabs: CenterTabIdentity[],
): tab is CenterTabIdentity {
  return Boolean(
    tab && tabs.some((candidate) => centerTabsEqual(candidate, tab)),
  );
}

function targetSet(tabs: CenterTabIdentity[]): Set<string> {
  return new Set(tabs.map(centerTabKey));
}

function resetConversationSelection() {
  resetSelection();
  workspaceState.error = undefined;
  composerDraft.text = "";
}

export function centerTabsToLeftOf(
  tab: CenterTabIdentity,
): CenterTabIdentity[] {
  const index = tabIndex(tab);
  return index <= 0 ? [] : workspaceState.openCenterTabs.slice(0, index);
}

export function centerTabsToRightOf(
  tab: CenterTabIdentity,
): CenterTabIdentity[] {
  const index = tabIndex(tab);
  return index === -1 ? [] : workspaceState.openCenterTabs.slice(index + 1);
}

export function centerTabsExcept(tab: CenterTabIdentity): CenterTabIdentity[] {
  return workspaceState.openCenterTabs.filter(
    (candidate) => !centerTabsEqual(candidate, tab),
  );
}

export function hasCenterTabsToLeftOf(tab: CenterTabIdentity): boolean {
  return centerTabsToLeftOf(tab).length > 0;
}

export function hasCenterTabsToRightOf(tab: CenterTabIdentity): boolean {
  return centerTabsToRightOf(tab).length > 0;
}

export async function closeCenterTabs(
  tabs: CenterTabIdentity[],
  fallbackPreferred?: CenterTabIdentity,
) {
  const targets = targetSet(tabs);
  if (!targets.size) return;

  const originalTabs = [...workspaceState.openCenterTabs];
  const closingIndices = originalTabs
    .map((tab, index) => (targets.has(centerTabKey(tab)) ? index : -1))
    .filter((index) => index !== -1);
  if (!closingIndices.length) return;

  const remainingTabs = originalTabs.filter(
    (tab) => !targets.has(centerTabKey(tab)),
  );
  const activeWasClosed = Boolean(
    workspaceState.activeCenterTab &&
    targets.has(centerTabKey(workspaceState.activeCenterTab)),
  );
  const selectedConversationWasClosed = Boolean(
    selection.conversationId &&
    targets.has(
      centerTabKey({ kind: "conversation", id: selection.conversationId }),
    ),
  );
  const activePendingWasClosed = Boolean(
    workspaceState.activeCenterTab?.kind === "pending-conversation" &&
    targets.has(centerTabKey(workspaceState.activeCenterTab)),
  );
  const fallback = tabIsInList(fallbackPreferred, remainingTabs)
    ? fallbackPreferred
    : mostRecentRemainingTab(tabs);

  const voiceTargets: Array<
    | { kind: "conversation"; id: string }
    | { kind: "pending-conversation"; id: string }
  > = [];
  for (const tab of originalTabs) {
    if (!targets.has(centerTabKey(tab))) continue;
    if (tab.kind === "conversation")
      voiceTargets.push({ kind: "conversation", id: tab.id });
    if (tab.kind === "pending-conversation")
      voiceTargets.push({ kind: "pending-conversation", id: tab.id });
  }
  await workspaceFeaturePorts().conversations.commands.cancelVoiceInputTargets(
    voiceTargets,
  );

  for (const tab of tabs) {
    if (isGlobalCenterTab(tab)) removeGlobalTabFromSessions(tab);
  }
  replaceOpenCenterTabs(remainingTabs);

  for (const tab of originalTabs) {
    if (!targets.has(centerTabKey(tab))) continue;
    if (tab.kind === "file")
      workspaceFeaturePorts().filesystem.commands.discardFileView(tab.id);
    if (tab.kind === "mermaid")
      workspaceFeaturePorts().filesystem.commands.discardMermaidView(tab.id);
    if (tab.kind === "diff")
      workspaceFeaturePorts().git.commands.discardDiffView(tab.id);
    if (tab.kind === "conversation")
      workspaceFeaturePorts().conversations.commands.discardConversationView(
        tab.id,
      );
    if (tab.kind === "pending-conversation")
      workspaceFeaturePorts().conversations.commands.discardPendingConversation(
        tab.id,
      );
  }

  const selectedTaskId = workspaceFeaturePorts().tasks.read.selectedTaskId;
  if (
    selectedTaskId &&
    targets.has(centerTabKey({ kind: "task", id: selectedTaskId }))
  ) {
    workspaceFeaturePorts().tasks.commands.setSelectedTaskId(undefined);
    workspaceFeaturePorts().tasks.commands.clearTaskLogs();
  }

  const remainingConversationIds = remainingTabs
    .filter(
      (tab): tab is Extract<CenterTabIdentity, { kind: "conversation" }> =>
        tab.kind === "conversation",
    )
    .map((tab) => tab.id);
  const activeConversationTabId =
    workspaceFeaturePorts().conversations.read.activeConversationTabId;
  if (
    activeConversationTabId &&
    targets.has(
      centerTabKey({ kind: "conversation", id: activeConversationTabId }),
    )
  ) {
    workspaceFeaturePorts().conversations.commands.setActiveConversationTab(
      fallback?.kind === "conversation"
        ? fallback.id
        : remainingConversationIds[0],
    );
  }

  if (
    (selectedConversationWasClosed || activePendingWasClosed) &&
    fallback?.kind !== "conversation" &&
    fallback?.kind !== "pending-conversation"
  ) {
    resetConversationSelection();
  }

  if (!activeWasClosed) return;
  setActiveCenterTab(undefined);
  if (fallback) await selectCenterTab(fallback);
}
