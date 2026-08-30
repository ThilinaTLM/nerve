import { conversationWorkspaceCommands } from "$lib/features/conversations/workspace-commands.svelte";
import { filesystemWorkspaceCommands } from "$lib/features/filesystem/workspace.svelte";
import { gitWorkspaceCommands } from "$lib/features/git/workspace.svelte";
import { setLogWorkspaceTabOpen } from "$lib/features/logs/workspace.svelte";
import { setSettingsWorkspaceTabOpen } from "$lib/features/settings/workspace.svelte";
import { taskWorkspaceCommands } from "$lib/features/tasks/workspace.svelte";
import { workspaceState } from "./workspace-state.svelte";

/** Keep feature-specific tab projections aligned with the canonical center-tab list. */
export function syncCenterTabMirrors(): void {
  conversationWorkspaceCommands.setOpenConversationTabIds(
    idsForKind("conversation"),
  );
  taskWorkspaceCommands.setOpenTaskTabIds(idsForKind("task"));
  filesystemWorkspaceCommands.setOpenFileTabIds(idsForKind("file"));
  gitWorkspaceCommands.setOpenPrTabIds(idsForKind("pr"));
  gitWorkspaceCommands.setOpenDiffTabIds(idsForKind("diff"));
  setSettingsWorkspaceTabOpen(hasKind("settings"));
  setLogWorkspaceTabOpen(hasKind("logs"));
}

function idsForKind(
  kind: (typeof workspaceState.openCenterTabs)[number]["kind"],
): string[] {
  return workspaceState.openCenterTabs
    .filter((tab) => tab.kind === kind)
    .map((tab) => tab.id);
}

function hasKind(
  kind: (typeof workspaceState.openCenterTabs)[number]["kind"],
): boolean {
  return workspaceState.openCenterTabs.some((tab) => tab.kind === kind);
}
