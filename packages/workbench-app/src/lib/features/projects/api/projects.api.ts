import { protocolRequest as workbenchRequest } from "$lib/application/startup/workbench-connection";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { createId } from "@nervekit/contracts";
import type { Project } from "@nervekit/contracts/core";
import {
  taskDefinitionSchema,
  type TaskDefinition,
  type CreateTaskDefinitionRequest,
  type UpdateTaskDefinitionRequest,
} from "@nervekit/contracts/task-definitions";
import type { ProjectEditor } from "@nervekit/contracts/projects";
export async function createProject(directory: string): Promise<Project> {
  return requestConversation("project.create", {
    id: createId("proj"),
    name: directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory,
    directory,
  });
}
export function getProject(projectId: string): Promise<Project | null> {
  return requestConversation("project.get", { projectId });
}
export function updateProject(
  projectId: string,
  patch: Partial<Pick<Project, "name" | "directory">>,
): Promise<Project> {
  return requestConversation("project.update", { projectId, patch });
}
export function deleteProject(projectId: string): Promise<null> {
  return requestConversation("project.delete", { projectId });
}
export async function openProjectInEditor(
  projectId: string,
  editor: ProjectEditor,
  path?: string,
) {
  return (
    await workbenchRequest("project.openEditor", { projectId, editor, path })
  ).result;
}
export async function openProjectInTerminal(projectId: string, path?: string) {
  return (await workbenchRequest("project.openTerminal", { projectId, path }))
    .result;
}
export async function getTaskDefinitions(
  projectId: string,
): Promise<TaskDefinition[]> {
  const definitions = (
    await workbenchRequest("taskDefinition.list", { projectId })
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
    await workbenchRequest("taskDefinition.create", { projectId, ...body })
  ).result.definition;
  return taskDefinitionSchema.parse(definition);
}

export async function updateTaskDefinition(
  projectId: string,
  definitionId: string,
  body: UpdateTaskDefinitionRequest,
): Promise<TaskDefinition> {
  const definition = (
    await workbenchRequest("taskDefinition.update", {
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
  await workbenchRequest("taskDefinition.delete", { projectId, definitionId });
}
