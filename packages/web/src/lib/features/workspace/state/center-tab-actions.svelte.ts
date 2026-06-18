import {
  type VoiceInputTarget,
  voiceInputSession,
} from "$lib/core/audio/voice-input-session.svelte";
import {
  conversationViewKey,
  fileViewKey,
  pendingConversationKey,
} from "$lib/core/state/state-keys";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { saveConversationTabs } from "$lib/features/conversations/state/conversation-tabs";
import { fileState } from "$lib/features/filesystem/state/file-state.svelte";
import { processState } from "$lib/features/processes/state/process-state.svelte";
import type { CenterTabIdentity } from "$lib/features/state-types";
import {
  composerDraft,
  resetSelection,
  selection,
} from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  centerTabKey,
  centerTabsEqual,
  replaceOpenCenterTabs,
  selectCenterTab,
} from "./center-tabs.svelte";

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

function persistOpenConversationTabs() {
  saveConversationTabs(
    conversationState.openConversationTabIds,
    conversationState.activeConversationTabId,
  );
}

function nearestRemainingTab(
  originalTabs: CenterTabIdentity[],
  remainingTabs: CenterTabIdentity[],
  closingIndices: number[],
): CenterTabIdentity | undefined {
  if (!remainingTabs.length) return undefined;
  const firstClosingIndex = Math.min(...closingIndices);
  const atOrAfter = originalTabs
    .slice(firstClosingIndex)
    .find((tab) =>
      remainingTabs.some((candidate) => centerTabsEqual(candidate, tab)),
    );
  if (atOrAfter) return atOrAfter;
  return originalTabs
    .slice(0, firstClosingIndex)
    .reverse()
    .find((tab) =>
      remainingTabs.some((candidate) => centerTabsEqual(candidate, tab)),
    );
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
    : nearestRemainingTab(originalTabs, remainingTabs, closingIndices);

  const voiceTargets: VoiceInputTarget[] = [];
  for (const tab of originalTabs) {
    if (!targets.has(centerTabKey(tab))) continue;
    if (tab.kind === "conversation")
      voiceTargets.push({ kind: "conversation", id: tab.id });
    if (tab.kind === "pending-conversation")
      voiceTargets.push({ kind: "pending-conversation", id: tab.id });
  }
  await voiceInputSession.cancelIfTargets(voiceTargets);

  replaceOpenCenterTabs(remainingTabs);

  for (const tab of originalTabs) {
    if (!targets.has(centerTabKey(tab))) continue;
    if (tab.kind === "file") delete fileState.fileViews[fileViewKey(tab.id)];
    if (tab.kind === "conversation")
      delete conversationState.conversationViews[conversationViewKey(tab.id)];
    if (tab.kind === "pending-conversation")
      delete conversationState.pendingConversations[
        pendingConversationKey(tab.id)
      ];
  }

  if (
    processState.selectedProcessId &&
    targets.has(
      centerTabKey({ kind: "process", id: processState.selectedProcessId }),
    )
  ) {
    processState.selectedProcessId = undefined;
    processState.processLogs = undefined;
  }

  const remainingConversationIds = remainingTabs
    .filter(
      (tab): tab is Extract<CenterTabIdentity, { kind: "conversation" }> =>
        tab.kind === "conversation",
    )
    .map((tab) => tab.id);
  if (
    conversationState.activeConversationTabId &&
    targets.has(
      centerTabKey({
        kind: "conversation",
        id: conversationState.activeConversationTabId,
      }),
    )
  ) {
    conversationState.activeConversationTabId =
      fallback?.kind === "conversation"
        ? fallback.id
        : remainingConversationIds[0];
  }

  if (
    (selectedConversationWasClosed || activePendingWasClosed) &&
    fallback?.kind !== "conversation" &&
    fallback?.kind !== "pending-conversation"
  ) {
    resetConversationSelection();
  }

  persistOpenConversationTabs();

  if (!activeWasClosed) return;
  workspaceState.activeCenterTab = undefined;
  if (fallback) await selectCenterTab(fallback);
}
