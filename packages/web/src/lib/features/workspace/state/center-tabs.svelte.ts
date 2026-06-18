import type { CenterTabIdentity } from "$lib/core/types/state-types";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { fileState } from "$lib/features/filesystem/state/file-state.svelte";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { logsState } from "$lib/features/logs/state/log-state.svelte";
import { processState } from "$lib/features/processes/state/process-state.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
export function centerTabKey(tab: CenterTabIdentity): string {
  return `${tab.kind}:${tab.id}`;
}

export function centerTabsEqual(
  left: CenterTabIdentity | undefined,
  right: CenterTabIdentity | undefined,
): boolean {
  return Boolean(
    left && right && left.kind === right.kind && left.id === right.id,
  );
}

function syncLegacyTabFields() {
  conversationState.openConversationTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "conversation")
    .map((tab) => tab.id);
  processState.openProcessTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "process")
    .map((tab) => tab.id);
  fileState.openFileTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "file")
    .map((tab) => tab.id);
  gitState.openPrTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "pr")
    .map((tab) => tab.id);
  settingsState.settingsTabOpen = workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "settings",
  );
  logsState.logsTabOpen = workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "logs",
  );
}

export function replaceOpenCenterTabs(tabs: CenterTabIdentity[]) {
  const seen = new Set<string>();
  workspaceState.openCenterTabs = tabs.filter((tab) => {
    const key = centerTabKey(tab);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  syncLegacyTabFields();
}

export function addCenterTab(tab: CenterTabIdentity) {
  if (
    !workspaceState.openCenterTabs.some((candidate) =>
      centerTabsEqual(candidate, tab),
    )
  ) {
    workspaceState.openCenterTabs = [...workspaceState.openCenterTabs, tab];
    syncLegacyTabFields();
  }
}

export function replaceCenterTab(
  previous: CenterTabIdentity,
  next: CenterTabIdentity,
) {
  replaceOpenCenterTabs(
    workspaceState.openCenterTabs.map((tab) =>
      centerTabsEqual(tab, previous) ? next : tab,
    ),
  );
  if (centerTabsEqual(workspaceState.activeCenterTab, previous)) {
    workspaceState.activeCenterTab = next;
  }
}

export function nextCenterTabAfterClose(
  tab: CenterTabIdentity,
): CenterTabIdentity | undefined {
  const tabs = workspaceState.openCenterTabs;
  const closingIndex = tabs.findIndex((candidate) =>
    centerTabsEqual(candidate, tab),
  );
  if (closingIndex === -1) return fallbackCenterTab(tab);
  const remaining = tabs.filter(
    (candidate) => !centerTabsEqual(candidate, tab),
  );
  return remaining[closingIndex] ?? remaining[closingIndex - 1] ?? remaining[0];
}

export function removeCenterTab(tab: CenterTabIdentity) {
  replaceOpenCenterTabs(
    workspaceState.openCenterTabs.filter(
      (candidate) => !centerTabsEqual(candidate, tab),
    ),
  );
}

export function setActiveCenterTab(tab: CenterTabIdentity | undefined) {
  if (tab) addCenterTab(tab);
  workspaceState.activeCenterTab = tab;
  if (tab?.kind === "process") processState.selectedProcessId = tab.id;
}

export function fallbackCenterTab(
  excluding?: CenterTabIdentity,
): CenterTabIdentity | undefined {
  return workspaceState.openCenterTabs.find(
    (tab) => !excluding || !centerTabsEqual(tab, excluding),
  );
}

export async function selectCenterTab(tab: CenterTabIdentity | undefined) {
  if (!tab) {
    setActiveCenterTab(undefined);
    return;
  }
  switch (tab.kind) {
    case "conversation": {
      const { openConversation } = await import(
        "$lib/features/conversations/state/conversation-flow.svelte"
      );
      await openConversation(tab.id);
      return;
    }
    case "pending-conversation": {
      const { selectPendingConversation } = await import(
        "$lib/features/conversations/state/conversation-flow.svelte"
      );
      selectPendingConversation(tab.id);
      return;
    }
    case "process": {
      const { selectCenterProcessTab } = await import(
        "$lib/features/processes/state/process-tabs.svelte"
      );
      await selectCenterProcessTab(tab.id);
      return;
    }
    case "file": {
      const { selectCenterFileTab } = await import(
        "$lib/features/filesystem/state/file-tabs.svelte"
      );
      await selectCenterFileTab(tab.id);
      return;
    }
    case "pr": {
      const { selectCenterPrTab } = await import(
        "$lib/features/git/state/pr-tabs.svelte"
      );
      await selectCenterPrTab(tab.id);
      return;
    }
    case "settings": {
      const { selectCenterSettingsTab } = await import(
        "$lib/features/settings/state/settings-actions.svelte"
      );
      await selectCenterSettingsTab();
      return;
    }
    case "logs": {
      const { selectCenterLogsTab } = await import(
        "$lib/features/logs/state/logs.svelte"
      );
      selectCenterLogsTab();
      return;
    }
  }
}

export async function closeCenterTab(tab: CenterTabIdentity) {
  switch (tab.kind) {
    case "conversation": {
      const { closeConversationTab } = await import(
        "$lib/features/conversations/state/conversation-flow.svelte"
      );
      await closeConversationTab(tab.id);
      return;
    }
    case "pending-conversation": {
      const { closePendingConversationTab } = await import(
        "$lib/features/conversations/state/conversation-flow.svelte"
      );
      await closePendingConversationTab(tab.id);
      return;
    }
    case "process": {
      const { closeProcessTab } = await import(
        "$lib/features/processes/state/process-tabs.svelte"
      );
      await closeProcessTab(tab.id);
      return;
    }
    case "file": {
      const { closeFileTab } = await import(
        "$lib/features/filesystem/state/file-tabs.svelte"
      );
      closeFileTab(tab.id);
      return;
    }
    case "pr": {
      const { closePrTab } = await import(
        "$lib/features/git/state/pr-tabs.svelte"
      );
      closePrTab(tab.id);
      return;
    }
    case "settings": {
      const { closeSettingsTab } = await import(
        "$lib/features/settings/state/settings-actions.svelte"
      );
      closeSettingsTab();
      return;
    }
    case "logs": {
      const { closeLogsTab } = await import(
        "$lib/features/logs/state/logs.svelte"
      );
      closeLogsTab();
      return;
    }
  }
}

export function activateFallbackCenterTab() {
  setActiveCenterTab(fallbackCenterTab());
}
