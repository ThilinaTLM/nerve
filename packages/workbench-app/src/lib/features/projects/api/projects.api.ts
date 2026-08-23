import { taskDefinitionSchema } from "@nervekit/contracts";
import type {
  CreateTaskDefinitionRequest,
  OpenProjectInEditorResponse,
  OpenProjectInTerminalResponse,
  ProjectEditor,
  TaskDefinition,
  ProjectRecord,
  ProjectSupervisionPreferences,
  PruneProjectConversationsRequest,
  PruneProjectConversationsResponse,
  UpdateTaskDefinitionRequest,
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

export async function getProjectPermissions(
  projectId: string,
): Promise<ProjectSupervisionPreferences> {
  return (await protocolRequest("project.permissions.get", { projectId }))
    .result.permissions;
}

export async function updateProjectPermissions(
  projectId: string,
  permissions: ProjectSupervisionPreferences,
): Promise<ProjectSupervisionPreferences> {
  return (
    await protocolRequest("project.permissions.update", {
      projectId,
      permissions,
    })
  ).result.permissions;
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
  path?: string,
): Promise<OpenProjectInEditorResponse> {
  return (
    await protocolRequest("project.openEditor", {
      projectId,
      editor,
      path,
    })
  ).result;
}

export async function openProjectInTerminal(
  projectId: string,
  path?: string,
): Promise<OpenProjectInTerminalResponse> {
  return (
    await protocolRequest("project.openTerminal", {
      projectId,
      path,
    })
  ).result;
}

export async function getTaskDefinitions(
  projectId: string,
): Promise<TaskDefinition[]> {
  const definitions = (
    await protocolRequest("taskDefinition.list", { projectId })
  ).result.definitions;
  return definitions.map((definition) =>
    taskDefinitionSchema.parse(definition),
  );
}

export async function createTaskDefinition(
  projectId: string,
  body: CreateTaskDefinitionRequest,
): Promise<TaskDefinition> {
  const definition = (
    await protocolRequest("taskDefinition.create", { projectId, ...body })
  ).result.definition;
  return taskDefinitionSchema.parse(definition);
}

export async function updateTaskDefinition(
  projectId: string,
  definitionId: string,
  body: UpdateTaskDefinitionRequest,
): Promise<TaskDefinition> {
  const definition = (
    await protocolRequest("taskDefinition.update", {
      projectId,
      definitionId,
      ...body,
    })
  ).result.definition;
  return taskDefinitionSchema.parse(definition);
}

export async function deleteTaskDefinition(
  projectId: string,
  definitionId: string,
): Promise<void> {
  await protocolRequest("taskDefinition.delete", { projectId, definitionId });
}
