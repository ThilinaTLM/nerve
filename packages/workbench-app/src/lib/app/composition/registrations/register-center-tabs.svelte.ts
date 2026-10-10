import { selection } from "$lib/application/workspace/selection.svelte";
import { setActiveCenterTab } from "$lib/application/workspace/center-tabs.svelte";
import { closeCenterTabs } from "$lib/application/workspace/center-tab-actions.svelte";
import {
  closeFileTab,
  selectCenterFileTab,
} from "$lib/features/filesystem/state/file-tabs.svelte";
import {
  closeMermaidTab,
  selectCenterMermaidTab,
} from "$lib/features/filesystem/state/mermaid-tabs.svelte";
import {
  closeDiffTab,
  selectCenterDiffTab,
} from "$lib/features/git/state/diff-tabs.svelte";
import {
  closePrTab,
  selectCenterPrTab,
} from "$lib/features/git/state/pr-tabs.svelte";
import {
  closeLogsTab,
  selectCenterLogsTab,
} from "$lib/features/logs/state/logs.svelte";
import {
  closeDiscoverTab,
  selectCenterDiscoverTab,
} from "$lib/app/discover/tabs.svelte";
import {
  closeSettingsTab,
  selectCenterSettingsTab,
} from "$lib/application/settings/settings-actions.svelte";
import {
  closeTaskTab,
  selectCenterTaskTab,
} from "$lib/features/tasks/state/task-tabs.svelte";
import { registerCenterTabDispatch } from "$lib/application/workspace/center-tabs.svelte";

registerCenterTabDispatch({
  select: {
    conversation: (tab) => {
      selection.conversationId = tab.id;
      setActiveCenterTab(tab);
    },
    "pending-conversation": (tab) => setActiveCenterTab(tab),
    task: (tab) => selectCenterTaskTab(tab.id),
    file: (tab) => selectCenterFileTab(tab.id),
    mermaid: (tab) => selectCenterMermaidTab(tab.id),
    pr: (tab) => selectCenterPrTab(tab.id),
    diff: (tab) => selectCenterDiffTab(tab.id),
    settings: () => selectCenterSettingsTab(),
    logs: () => selectCenterLogsTab(),
    discover: () => selectCenterDiscoverTab(),
  },
  close: {
    conversation: (tab) => closeCenterTabs([tab]),
    "pending-conversation": (tab) => closeCenterTabs([tab]),
    task: (tab) => closeTaskTab(tab.id),
    file: (tab) => closeFileTab(tab.id),
    mermaid: (tab) => closeMermaidTab(tab.id),
    pr: (tab) => closePrTab(tab.id),
    diff: (tab) => closeDiffTab(tab.id),
    settings: () => closeSettingsTab(),
    logs: () => closeLogsTab(),
    discover: () => closeDiscoverTab(),
  },
});
