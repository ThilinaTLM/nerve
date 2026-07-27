import { authState } from "$lib/features/auth/state/auth-state.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { fileState } from "$lib/features/filesystem/state/file-state.svelte";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { logsState } from "$lib/features/logs/state/log-state.svelte";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import { workspaceState } from "./workspace-state.svelte";

/** Keep feature-specific tab fields aligned with the canonical center-tab list. */
export function syncCenterTabMirrors(): void {
  conversationState.openConversationTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "conversation")
    .map((tab) => tab.id);
  taskState.openTaskTabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "task")
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
  authState.authTabOpen = workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "auth",
  );
  logsState.logsTabOpen = workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "logs",
  );
}
