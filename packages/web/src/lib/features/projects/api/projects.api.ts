import type {
  CreatePinnedCommandRequest,
  OpenProjectInEditorResponse,
  PinnedCommand,
  ProjectEditor,
  ProjectRecord,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
  UpdatePinnedCommandRequest,
} from "@nervekit/shared";
import { protocolRequest } from "../../../core/protocol/http-client";

export async function createProject(dir: string): Promise<ProjectRecord> {
  return (
    await protocolRequest<{ project: ProjectRecord }>("project.create", { dir })
  ).result.project;
}

export async function getProject(projectId: string): Promise<ProjectRecord> {
  return (
    await protocolRequest<{ project: ProjectRecord }>("project.get", {
      projectId,
    })
  ).result.project;
}

export async function deleteProject(projectId: string): Promise<void> {
  await protocolRequest<{ ok: true }>("project.delete", { projectId });
}

export async function pruneProjectConversations(
  projectId: string,
  request: PruneProjectConversationsRequest,
): Promise<PruneProjectConversationsResponse> {
  return (
    await protocolRequest<PruneProjectConversationsResponse>(
      "project.conversations.prune",
      { projectId, ...request },
    )
  ).result;
}

export async function openProjectInEditor(
  projectId: string,
  editor: ProjectEditor,
): Promise<OpenProjectInEditorResponse> {
  return (
    await protocolRequest<OpenProjectInEditorResponse>("project.openEditor", {
      projectId,
      editor,
    })
  ).result;
}

export async function getPinnedCommands(
  projectId: string,
): Promise<PinnedCommand[]> {
  return (
    await protocolRequest<{ commands: PinnedCommand[] }>("pinnedCommand.list", {
      projectId,
    })
  ).result.commands;
}

export async function createPinnedCommand(
  projectId: string,
  body: CreatePinnedCommandRequest,
): Promise<PinnedCommand> {
  return (
    await protocolRequest<{ command: PinnedCommand }>("pinnedCommand.create", {
      projectId,
      ...body,
    })
  ).result.command;
}

export async function updatePinnedCommand(
  projectId: string,
  commandId: string,
  body: UpdatePinnedCommandRequest,
): Promise<PinnedCommand> {
  return (
    await protocolRequest<{ command: PinnedCommand }>("pinnedCommand.update", {
      projectId,
      commandId,
      ...body,
    })
  ).result.command;
}

export async function deletePinnedCommand(
  projectId: string,
  commandId: string,
): Promise<void> {
  await protocolRequest<{ ok: true }>("pinnedCommand.delete", {
    projectId,
    commandId,
  });
}
