import {
  type CreateLaunchDefinitionRequest,
  type LaunchDefinition,
  type UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import { createId } from "@nervekit/contracts";
import { type Project } from "@nervekit/contracts/core";
import { ApplicationError } from "../../core/application-error.js";
import type { LaunchDefinitionRepository } from "./launch-definition.repository.js";

export class LaunchDefinitionService {
  constructor(
    private readonly repository: LaunchDefinitionRepository,
    private readonly getProject: (projectId: string) => Project,
    private readonly publish?: (
      type: string,
      data: Record<string, unknown>,
    ) => Promise<void>,
  ) {}

  async list(projectId: string): Promise<LaunchDefinition[]> {
    this.getProject(projectId);
    return this.repository.list(projectId);
  }

  async get(
    projectId: string,
    definitionId: string,
  ): Promise<LaunchDefinition> {
    const definition = (await this.list(projectId)).find(
      (item) => item.id === definitionId,
    );
    if (!definition) throw this.notFound();
    return definition;
  }

  async create(
    projectId: string,
    request: CreateLaunchDefinitionRequest,
  ): Promise<LaunchDefinition> {
    this.getProject(projectId);
    const now = new Date().toISOString();
    const definition: LaunchDefinition = {
      id: createId("launchdef"),
      scope: { kind: "project", projectId },
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      port: request.port,
      runPolicy: request.runPolicy,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.replace(projectId, [
      ...(await this.repository.list(projectId)),
      definition,
    ]);
    await this.publish?.("launchDefinition.created", { definition });
    return definition;
  }

  async update(
    projectId: string,
    definitionId: string,
    request: UpdateLaunchDefinitionRequest,
  ): Promise<LaunchDefinition> {
    const existing = await this.list(projectId);
    const index = existing.findIndex((item) => item.id === definitionId);
    const current = existing[index];
    if (!current) throw this.notFound();
    const updated: LaunchDefinition = {
      ...current,
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      port: request.port,
      runPolicy: request.runPolicy,
      updatedAt: new Date().toISOString(),
    };
    const next = [...existing];
    next[index] = updated;
    await this.repository.replace(projectId, next);
    await this.publish?.("launchDefinition.updated", { definition: updated });
    return updated;
  }

  async remove(projectId: string, definitionId: string): Promise<void> {
    const existing = await this.list(projectId);
    const next = existing.filter((item) => item.id !== definitionId);
    if (next.length === existing.length) throw this.notFound();
    await this.repository.replace(projectId, next);
    await this.publish?.("launchDefinition.deleted", { definitionId });
  }

  private notFound(): ApplicationError {
    return new ApplicationError(
      404,
      "TASK_DEFINITION_NOT_FOUND",
      "Launch definition not found.",
    );
  }
}
