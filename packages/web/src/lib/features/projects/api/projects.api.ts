import type {
  CreatePinnedCommandRequest,
  OpenProjectInEditorResponse,
  PinnedCommand,
  ProjectEditor,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
} from "@nervekit/shared";
import {
  apiDeleteNoContent,
  apiGet,
  apiPathSegment,
  apiPost,
} from "../../../core/api/client";

export async function deleteProject(projectId: string): Promise<void> {
  await apiDeleteNoContent(`/api/projects/${apiPathSegment(projectId)}`);
}

export async function pruneProjectConversations(
  projectId: string,
  request: PruneProjectConversationsRequest,
): Promise<PruneProjectConversationsResponse> {
  return apiPost<PruneProjectConversationsResponse>(
    `/api/projects/${apiPathSegment(projectId)}/conversations/prune`,
    request,
  );
}

export async function openProjectInEditor(
  projectId: string,
  editor: ProjectEditor,
): Promise<OpenProjectInEditorResponse> {
  return apiPost<OpenProjectInEditorResponse>(
    `/api/projects/${apiPathSegment(projectId)}/open-editor`,
    { editor },
  );
}

export async function getPinnedCommands(
  projectId: string,
): Promise<PinnedCommand[]> {
  return (
    await apiGet<{ commands: PinnedCommand[] }>(
      `/api/projects/${apiPathSegment(projectId)}/pinned-commands`,
    )
  ).commands;
}

export async function createPinnedCommand(
  projectId: string,
  body: CreatePinnedCommandRequest,
): Promise<PinnedCommand> {
  return (
    await apiPost<{ command: PinnedCommand }>(
      `/api/projects/${apiPathSegment(projectId)}/pinned-commands`,
      body,
    )
  ).command;
}

export async function deletePinnedCommand(
  projectId: string,
  commandId: string,
): Promise<void> {
  await apiDeleteNoContent(
    `/api/projects/${apiPathSegment(projectId)}/pinned-commands/${apiPathSegment(commandId)}`,
  );
}
