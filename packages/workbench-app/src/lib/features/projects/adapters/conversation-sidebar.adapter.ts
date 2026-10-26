import type { ConversationSummary, Project } from "@nervekit/contracts/core";
import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  PruneProjectConversationsRequest,
  UpdateConversationStateRequest,
} from "$lib/domain/projects/sidebar-view-models";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { loadWorkspaceState } from "$lib/application/workspace/workspace-actions.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";

export function sidebarProjects(projects: Project[]): ProjectRecord[] {
  return projects.map((project) => ({ ...project, dir: project.directory }));
}
export function sidebarConversations(
  rows: ConversationSummary[],
): ConversationRecord[] {
  return rows
    .filter((row) => row.parentConversationId === null)
    .map((row) => ({
      ...row,
      pinned: row.pinnedAt !== null,
      activeAgentId: row.id,
      permissionRuleSetId: row.permissionRuleSetId,
    }));
}
export function sidebarAgents(rows: ConversationRecord[]): AgentRecord[] {
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.id,
    agentProfile: row.agentProfile,
    model: row.model,
    permissionRuleSetId: row.permissionRuleSetId,
  }));
}
export async function updateConversationStateAndRefresh(
  conversationId: string,
  request: UpdateConversationStateRequest,
): Promise<void> {
  try {
    const { clearRuntimeStatus, ...update } = request;
    await requestConversation("conversation.update", {
      conversationId,
      patch: { ...update, clearStatus: clearRuntimeStatus },
    });
    await loadWorkspaceState();
  } catch (error) {
    notify.error("Could not update conversation", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Core has individual deletion; keep the original cleanup policy at its UI owner. */
async function conversationHasActiveWork(
  conversationId: string,
): Promise<boolean> {
  const snapshot = await requestConversation("conversation.getSnapshot", {
    conversationId,
  });
  if (
    snapshot.conversation.status === "running" ||
    snapshot.conversation.status === "waiting" ||
    snapshot.queue.length > 0 ||
    snapshot.asyncBash.some((task) => task.status === "running")
  )
    return true;
  for (const child of snapshot.children)
    if (await conversationHasActiveWork(child.id)) return true;
  return false;
}

export async function pruneProjectConversationsAndRefresh(
  projectId: string,
  request: PruneProjectConversationsRequest,
): Promise<void> {
  try {
    const rows = await requestConversation("conversation.list", {
      projectId,
      parentConversationId: null,
    });
    const ordered = [...rows].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    const cutoff =
      Date.now() - (request.olderThanDays ?? 0) * 24 * 60 * 60 * 1000;
    const eligible =
      request.strategy === "keepLatest"
        ? ordered.slice(request.keepLatest ?? 20)
        : ordered.filter((row) =>
            request.strategy === "completed"
              ? Boolean(row.completedAt)
              : Date.parse(row.updatedAt) < cutoff,
          );
    for (const row of eligible) {
      if (await conversationHasActiveWork(row.id)) continue;
      await requestConversation("conversation.delete", {
        conversationId: row.id,
      });
    }
    await loadWorkspaceState();
  } catch (error) {
    notify.error("Could not clean up conversations", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
