import { pinnedCommandSchema } from "@nervekit/contracts";
import type {
  CreatePinnedCommandRequest,
  OpenProjectInEditorResponse,
  PinnedCommand,
  ProjectEditor,
  ProjectRecord,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function createProject(dir: string): Promise<ProjectRecord> {
  return (await protocolRequest("project.create", { dir })).result.project;
}

export async function getProject(projectId: string): Promise<ProjectRecord> {
  return (
    await protocolRequest("project.get", {
      projectId,
    })
  ).result.project;
}

export async function deleteProject(projectId: string): Promise<void> {
  await protocolRequest("project.delete", { projectId });
}

export async function pruneProjectConversations(
  projectId: string,
  request: PruneProjectConversationsRequest,
): Promise<PruneProjectConversationsResponse> {
  return (
    await protocolRequest("project.conversations.prune", {
      projectId,
      ...request,
    })
  ).result;
}

export async function openProjectInEditor(
  projectId: string,
  editor: ProjectEditor,
): Promise<OpenProjectInEditorResponse> {
  return (
    await protocolRequest("project.openEditor", {
      projectId,
      editor,
    })
  ).result;
}

export async function getPinnedCommands(
  projectId: string,
): Promise<PinnedCommand[]> {
  const commands = (
    await protocolRequest("pinnedCommand.list", {
      projectId,
    })
  ).result.commands;
  return commands.map((command) => pinnedCommandSchema.parse(command));
}

export async function createPinnedCommand(
  projectId: string,
  body: CreatePinnedCommandRequest,
): Promise<PinnedCommand> {
  const command = (
    await protocolRequest("pinnedCommand.create", {
      projectId,
      ...body,
    })
  ).result.command;
  return pinnedCommandSchema.parse(command);
}

export async function updatePinnedCommand(
  projectId: string,
  commandId: string,
  body: UpdatePinnedCommandRequest,
): Promise<PinnedCommand> {
  const command = (
    await protocolRequest("pinnedCommand.update", {
      projectId,
      commandId,
      ...body,
    })
  ).result.command;
  return pinnedCommandSchema.parse(command);
}

export async function deletePinnedCommand(
  projectId: string,
  commandId: string,
): Promise<void> {
  await protocolRequest("pinnedCommand.delete", {
    projectId,
    commandId,
  });
}
