import {
  closeConversationTab,
  closePendingConversationTab,
  openConversation,
  selectPendingConversation,
} from "$lib/features/conversations/state/conversation-flow.svelte";
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
  closeSettingsTab,
  selectCenterSettingsTab,
} from "$lib/features/settings/state/settings-actions.svelte";
import {
  closeTaskTab,
  selectCenterTaskTab,
} from "$lib/features/tasks/state/task-tabs.svelte";
import { registerCenterTabDispatch } from "$lib/application/workspace/center-tabs.svelte";

registerCenterTabDispatch({
  select: {
    conversation: (tab) => openConversation(tab.id),
    "pending-conversation": (tab) => selectPendingConversation(tab.id),
    task: (tab) => selectCenterTaskTab(tab.id),
    file: (tab) => selectCenterFileTab(tab.id),
    mermaid: (tab) => selectCenterMermaidTab(tab.id),
    pr: (tab) => selectCenterPrTab(tab.id),
    diff: (tab) => selectCenterDiffTab(tab.id),
    settings: () => selectCenterSettingsTab(),
    logs: () => selectCenterLogsTab(),
  },
  close: {
    conversation: (tab) => closeConversationTab(tab.id),
    "pending-conversation": (tab) => closePendingConversationTab(tab.id),
    task: (tab) => closeTaskTab(tab.id),
    file: (tab) => closeFileTab(tab.id),
    mermaid: (tab) => closeMermaidTab(tab.id),
    pr: (tab) => closePrTab(tab.id),
    diff: (tab) => closeDiffTab(tab.id),
    settings: () => closeSettingsTab(),
    logs: () => closeLogsTab(),
  },
});
