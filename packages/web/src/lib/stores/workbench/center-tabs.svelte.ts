import type { CenterTabIdentity } from "./state.svelte";
import { workbenchState } from "./state.svelte";

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
  workbenchState.openConversationTabIds = workbenchState.openCenterTabs
    .filter((tab) => tab.kind === "conversation")
    .map((tab) => tab.id);
  workbenchState.openProcessTabIds = workbenchState.openCenterTabs
    .filter((tab) => tab.kind === "process")
    .map((tab) => tab.id);
  workbenchState.openFileTabIds = workbenchState.openCenterTabs
    .filter((tab) => tab.kind === "file")
    .map((tab) => tab.id);
  workbenchState.openPrTabIds = workbenchState.openCenterTabs
    .filter((tab) => tab.kind === "pr")
    .map((tab) => tab.id);
  workbenchState.settingsTabOpen = workbenchState.openCenterTabs.some(
    (tab) => tab.kind === "settings",
  );
  workbenchState.logsTabOpen = workbenchState.openCenterTabs.some(
    (tab) => tab.kind === "logs",
  );
}

export function replaceOpenCenterTabs(tabs: CenterTabIdentity[]) {
  const seen = new Set<string>();
  workbenchState.openCenterTabs = tabs.filter((tab) => {
    const key = centerTabKey(tab);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  syncLegacyTabFields();
}

export function addCenterTab(tab: CenterTabIdentity) {
  if (
    !workbenchState.openCenterTabs.some((candidate) =>
      centerTabsEqual(candidate, tab),
    )
  ) {
    workbenchState.openCenterTabs = [...workbenchState.openCenterTabs, tab];
    syncLegacyTabFields();
  }
}

export function replaceCenterTab(
  previous: CenterTabIdentity,
  next: CenterTabIdentity,
) {
  replaceOpenCenterTabs(
    workbenchState.openCenterTabs.map((tab) =>
      centerTabsEqual(tab, previous) ? next : tab,
    ),
  );
  if (centerTabsEqual(workbenchState.activeCenterTab, previous)) {
    workbenchState.activeCenterTab = next;
  }
}

export function nextCenterTabAfterClose(
  tab: CenterTabIdentity,
): CenterTabIdentity | undefined {
  const tabs = workbenchState.openCenterTabs;
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
    workbenchState.openCenterTabs.filter(
      (candidate) => !centerTabsEqual(candidate, tab),
    ),
  );
}

export function setActiveCenterTab(tab: CenterTabIdentity | undefined) {
  if (tab) addCenterTab(tab);
  workbenchState.activeCenterTab = tab;
  if (tab?.kind === "process") workbenchState.selectedProcessId = tab.id;
}

export function fallbackCenterTab(
  excluding?: CenterTabIdentity,
): CenterTabIdentity | undefined {
  return workbenchState.openCenterTabs.find(
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
      const { openConversation } = await import("../conversation-flow.svelte");
      await openConversation(tab.id);
      return;
    }
    case "pending-conversation": {
      const { selectPendingConversation } = await import(
        "../conversation-flow.svelte"
      );
      selectPendingConversation(tab.id);
      return;
    }
    case "process": {
      const { selectCenterProcessTab } = await import("./process-tabs.svelte");
      await selectCenterProcessTab(tab.id);
      return;
    }
    case "file": {
      const { selectCenterFileTab } = await import("./file-tabs.svelte");
      await selectCenterFileTab(tab.id);
      return;
    }
    case "pr": {
      const { selectCenterPrTab } = await import("./pr-tabs.svelte");
      await selectCenterPrTab(tab.id);
      return;
    }
    case "settings": {
      const { selectCenterSettingsTab } = await import("../settings.svelte");
      await selectCenterSettingsTab();
      return;
    }
    case "logs": {
      const { selectCenterLogsTab } = await import("../logs.svelte");
      selectCenterLogsTab();
      return;
    }
  }
}

export async function closeCenterTab(tab: CenterTabIdentity) {
  switch (tab.kind) {
    case "conversation": {
      const { closeConversationTab } = await import(
        "../conversation-flow.svelte"
      );
      await closeConversationTab(tab.id);
      return;
    }
    case "pending-conversation": {
      const { closePendingConversationTab } = await import(
        "../conversation-flow.svelte"
      );
      await closePendingConversationTab(tab.id);
      return;
    }
    case "process": {
      const { closeProcessTab } = await import("./process-tabs.svelte");
      await closeProcessTab(tab.id);
      return;
    }
    case "file": {
      const { closeFileTab } = await import("./file-tabs.svelte");
      closeFileTab(tab.id);
      return;
    }
    case "pr": {
      const { closePrTab } = await import("./pr-tabs.svelte");
      closePrTab(tab.id);
      return;
    }
    case "settings": {
      const { closeSettingsTab } = await import("../settings.svelte");
      closeSettingsTab();
      return;
    }
    case "logs": {
      const { closeLogsTab } = await import("../logs.svelte");
      closeLogsTab();
      return;
    }
  }
}

export function activateFallbackCenterTab() {
  setActiveCenterTab(fallbackCenterTab());
}
