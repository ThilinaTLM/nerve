import type {
  CreatePinnedCommandRequest,
  PinnedCommand,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
} from "@nerve/shared";
import {
  apiDeleteNoContent,
  apiGet,
  apiPost,
} from "../../../shared/api/client";

export async function deleteProject(projectId: string): Promise<void> {
  await apiDeleteNoContent(`/api/projects/${projectId}`);
}

export async function pruneProjectConversations(
  projectId: string,
  request: PruneProjectConversationsRequest,
): Promise<PruneProjectConversationsResponse> {
  return apiPost<PruneProjectConversationsResponse>(
    `/api/projects/${projectId}/conversations/prune`,
    request,
  );
}

export async function getPinnedCommands(
  projectId: string,
): Promise<PinnedCommand[]> {
  return (
    await apiGet<{ commands: PinnedCommand[] }>(
      `/api/projects/${projectId}/pinned-commands`,
    )
  ).commands;
}

export async function createPinnedCommand(
  projectId: string,
  body: CreatePinnedCommandRequest,
): Promise<PinnedCommand> {
  return (
    await apiPost<{ command: PinnedCommand }>(
      `/api/projects/${projectId}/pinned-commands`,
      body,
    )
  ).command;
}

export async function deletePinnedCommand(
  projectId: string,
  commandId: string,
): Promise<void> {
  await apiDeleteNoContent(
    `/api/projects/${projectId}/pinned-commands/${commandId}`,
  );
}
