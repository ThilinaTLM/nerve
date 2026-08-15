import { disposeAuthTab, selectCenterAuthTab } from "$lib/features/auth";
import {
  afterCloseConversationTab,
  disposeConversationTab,
  disposePendingConversationTab,
  openConversation,
  selectPendingConversation,
} from "$lib/features/conversations/state/conversation-flow.svelte";
import {
  disposeFileTab,
  selectCenterFileTab,
} from "$lib/features/filesystem/state/file-tabs.svelte";
import {
  disposeDiffTab,
  selectCenterDiffTab,
} from "$lib/features/git/state/diff-tabs.svelte";
import {
  disposePrTab,
  selectCenterPrTab,
} from "$lib/features/git/state/pr-tabs.svelte";
import {
  disposeLogsTab,
  selectCenterLogsTab,
} from "$lib/features/logs/state/logs.svelte";
import {
  disposeSettingsTab,
  selectCenterSettingsTab,
} from "$lib/features/settings/state/settings-actions.svelte";
import {
  disposeTaskTab,
  selectCenterTaskTab,
} from "$lib/features/tasks/state/task-tabs.svelte";
import { registerCenterTabLifecycles } from "./center-tab-lifecycle.svelte";

registerCenterTabLifecycles({
  conversation: {
    select: (tab) => openConversation(tab.id),
    dispose: (tab) => disposeConversationTab(tab.id),
    afterClose: (tab, context) => afterCloseConversationTab(tab.id, context),
  },
  "pending-conversation": {
    select: (tab) => selectPendingConversation(tab.id),
    dispose: (tab) => disposePendingConversationTab(tab.id),
    afterClose: (tab, context) => afterCloseConversationTab(tab.id, context),
  },
  task: {
    select: (tab) => selectCenterTaskTab(tab.id),
    dispose: (tab) => disposeTaskTab(tab.id),
  },
  file: {
    select: (tab) => selectCenterFileTab(tab.id),
    dispose: (tab) => disposeFileTab(tab.id),
  },
  pr: {
    select: (tab) => selectCenterPrTab(tab.id),
    dispose: (tab) => disposePrTab(tab.id),
  },
  diff: {
    select: (tab) => selectCenterDiffTab(tab.id),
    dispose: (tab) => disposeDiffTab(tab.id),
  },
  settings: {
    select: () => selectCenterSettingsTab(),
    dispose: () => disposeSettingsTab(),
  },
  auth: {
    select: () => selectCenterAuthTab(),
    dispose: () => disposeAuthTab(),
  },
  logs: {
    select: () => selectCenterLogsTab(),
    dispose: () => disposeLogsTab(),
  },
});
