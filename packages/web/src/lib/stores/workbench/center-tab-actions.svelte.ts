import {
  type VoiceInputTarget,
  voiceInputSession,
} from "../../audio/voice-input-session.svelte";
import {
  composerDraft,
  resetSelection,
  selection,
} from "../../state/app-state.svelte";
import {
  centerTabKey,
  centerTabsEqual,
  replaceOpenCenterTabs,
  selectCenterTab,
} from "./center-tabs.svelte";
import { saveConversationTabs } from "./conversation-tabs";
import type { CenterTabIdentity } from "./state.svelte";
import { workbenchState } from "./state.svelte";

function tabIndex(tab: CenterTabIdentity): number {
  return workbenchState.openCenterTabs.findIndex((candidate) =>
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
  workbenchState.treeNodes = [];
  workbenchState.transcript = [];
  workbenchState.streamingText = "";
  workbenchState.sending = false;
  workbenchState.error = undefined;
  composerDraft.text = "";
}

function persistOpenConversationTabs() {
  saveConversationTabs(
    workbenchState.openConversationTabIds,
    workbenchState.activeConversationTabId,
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
  return index <= 0 ? [] : workbenchState.openCenterTabs.slice(0, index);
}

export function centerTabsToRightOf(
  tab: CenterTabIdentity,
): CenterTabIdentity[] {
  const index = tabIndex(tab);
  return index === -1 ? [] : workbenchState.openCenterTabs.slice(index + 1);
}

export function centerTabsExcept(tab: CenterTabIdentity): CenterTabIdentity[] {
  return workbenchState.openCenterTabs.filter(
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

  const originalTabs = [...workbenchState.openCenterTabs];
  const closingIndices = originalTabs
    .map((tab, index) => (targets.has(centerTabKey(tab)) ? index : -1))
    .filter((index) => index !== -1);
  if (!closingIndices.length) return;

  const remainingTabs = originalTabs.filter(
    (tab) => !targets.has(centerTabKey(tab)),
  );
  const activeWasClosed = Boolean(
    workbenchState.activeCenterTab &&
      targets.has(centerTabKey(workbenchState.activeCenterTab)),
  );
  const selectedConversationWasClosed = Boolean(
    selection.conversationId &&
      targets.has(
        centerTabKey({ kind: "conversation", id: selection.conversationId }),
      ),
  );
  const activePendingWasClosed = Boolean(
    workbenchState.activeCenterTab?.kind === "pending-conversation" &&
      targets.has(centerTabKey(workbenchState.activeCenterTab)),
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
    if (tab.kind === "file") delete workbenchState.fileViews[tab.id];
    if (tab.kind === "conversation")
      delete workbenchState.conversationViews[tab.id];
    if (tab.kind === "pending-conversation")
      delete workbenchState.pendingConversations[tab.id];
  }

  if (
    workbenchState.selectedProcessId &&
    targets.has(
      centerTabKey({ kind: "process", id: workbenchState.selectedProcessId }),
    )
  ) {
    workbenchState.selectedProcessId = undefined;
    workbenchState.processLogs = undefined;
  }

  const remainingConversationIds = remainingTabs
    .filter(
      (tab): tab is Extract<CenterTabIdentity, { kind: "conversation" }> =>
        tab.kind === "conversation",
    )
    .map((tab) => tab.id);
  if (
    workbenchState.activeConversationTabId &&
    targets.has(
      centerTabKey({
        kind: "conversation",
        id: workbenchState.activeConversationTabId,
      }),
    )
  ) {
    workbenchState.activeConversationTabId =
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
  workbenchState.activeCenterTab = undefined;
  if (fallback) await selectCenterTab(fallback);
}
