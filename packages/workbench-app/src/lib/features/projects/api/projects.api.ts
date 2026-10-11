import { protocolRequest as workbenchRequest } from "$lib/application/startup/workbench-connection";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { createId } from "@nervekit/contracts";
import type { Project } from "@nervekit/contracts/core";
import {
  launchDefinitionSchema,
  type LaunchDefinition,
  type CreateLaunchDefinitionRequest,
  type UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
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
export async function getLaunchDefinitions(
  projectId: string,
): Promise<LaunchDefinition[]> {
  const definitions = (
    await workbenchRequest("launchDefinition.list", { projectId })
  ).result.definitions;
  return definitions.map((definition) =>
    launchDefinitionSchema.parse(definition),
  );
}

export async function createLaunchDefinition(
  projectId: string,
  body: CreateLaunchDefinitionRequest,
): Promise<LaunchDefinition> {
  const definition = (
    await workbenchRequest("launchDefinition.create", { projectId, ...body })
  ).result.definition;
  return launchDefinitionSchema.parse(definition);
}

export async function updateLaunchDefinition(
  projectId: string,
  definitionId: string,
  body: UpdateLaunchDefinitionRequest,
): Promise<LaunchDefinition> {
  const definition = (
    await workbenchRequest("launchDefinition.update", {
      projectId,
      definitionId,
      ...body,
    })
  ).result.definition;
  return launchDefinitionSchema.parse(definition);
}

export async function deleteLaunchDefinition(
  projectId: string,
  definitionId: string,
): Promise<void> {
  await workbenchRequest("launchDefinition.delete", {
    projectId,
    definitionId,
  });
}
