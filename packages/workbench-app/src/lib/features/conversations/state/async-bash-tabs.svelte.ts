import type { AsyncBash } from "@nervekit/contracts/core";
import {
  addCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

export const asyncBashTabs = $state({
  commands: {} as Record<string, AsyncBash>,
  refreshVersions: {} as Record<string, number>,
});

export async function openAsyncBashTab(command: AsyncBash, projectId?: string) {
  const owner =
    projectId ??
    workspaceState.conversations.find(
      (conversation) => conversation.id === command.conversationId,
    )?.projectId;
  if (owner && owner !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/application/workspace/workspace-actions.svelte");
    await selectProject(owner);
  }
  asyncBashTabs.commands[command.id] = command;
  const tab = {
    kind: "async-bash" as const,
    id: command.id,
    conversationId: command.conversationId,
    projectId: owner,
    command: command.command,
  };
  addCenterTab(tab);
  setActiveCenterTab(tab);
}

/** Request a tail refresh without fetching or activating an inactive tab. */
export function requestAsyncBashRefresh(id: string): void {
  asyncBashTabs.refreshVersions[id] =
    (asyncBashTabs.refreshVersions[id] ?? 0) + 1;
}

export const asyncBashWorkspaceReadModel = {
  get asyncBashes() {
    return asyncBashTabs.commands;
  },
};
export function discardAsyncBashTab(id: string) {
  delete asyncBashTabs.commands[id];
  delete asyncBashTabs.refreshVersions[id];
}
