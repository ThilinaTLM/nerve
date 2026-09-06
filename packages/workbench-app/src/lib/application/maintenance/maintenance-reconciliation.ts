import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { loadWorkspaceState } from "$lib/application/workspace/workspace-actions.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { workspaceFeaturePorts } from "$lib/application/workspace/workspace-feature-ports.svelte";
import { removeTabsFromAllSessions } from "$lib/application/workspace/workspace-tab-sessions";
import { projectKey } from "$lib/domain/projects/project-tree";
export async function reconcileMaintenance(
  operation: MaintenanceOperation,
): Promise<void> {
  const previousIds = workspaceState.conversations.map(
    (conversation) => conversation.id,
  );
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  const remaining = new Set(
    workspaceState.conversations.map((conversation) => conversation.id),
  );
  const removed = new Set(previousIds.filter((id) => !remaining.has(id)));
  for (const session of Object.values(workspaceState.projectTabSessions)) {
    for (const tab of session.tabs)
      if (tab.kind === "conversation" && !remaining.has(tab.id))
        removed.add(tab.id);
  }
  for (const tab of workspaceState.openCenterTabs)
    if (tab.kind === "conversation" && !remaining.has(tab.id))
      removed.add(tab.id);
  removeTabsFromAllSessions(
    (tab) => tab.kind === "conversation" && removed.has(tab.id),
  );
  if (removed.size)
    await workspaceFeaturePorts().conversations.commands.removeConversationTabs(
      [...removed],
    );
  if (
    operation.project &&
    !workspaceState.projects.some(
      (project) => project.id === operation.project?.id,
    )
  )
    delete workspaceState.projectTabSessions[projectKey(operation.project)];
}
