import { closeAuthTab, selectCenterAuthTab } from "$lib/features/auth";
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
import { registerCenterTabDispatch } from "./center-tabs.svelte";

registerCenterTabDispatch({
  select: {
    conversation: (tab) => openConversation(tab.id),
    "pending-conversation": (tab) => selectPendingConversation(tab.id),
    task: (tab) => selectCenterTaskTab(tab.id),
    file: (tab) => selectCenterFileTab(tab.id),
    pr: (tab) => selectCenterPrTab(tab.id),
    settings: () => selectCenterSettingsTab(),
    auth: () => selectCenterAuthTab(),
    logs: () => selectCenterLogsTab(),
  },
  close: {
    conversation: (tab) => closeConversationTab(tab.id),
    "pending-conversation": (tab) => closePendingConversationTab(tab.id),
    task: (tab) => closeTaskTab(tab.id),
    file: (tab) => closeFileTab(tab.id),
    pr: (tab) => closePrTab(tab.id),
    settings: () => closeSettingsTab(),
    auth: () => closeAuthTab(),
    logs: () => closeLogsTab(),
  },
});
