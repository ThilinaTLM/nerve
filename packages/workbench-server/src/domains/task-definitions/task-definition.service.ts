import {
  type CreateTaskDefinitionRequest,
  createId,
  type ProjectRecord,
  type TaskDefinition,
  type UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import { ApplicationError } from "../../core/application-error.js";
import type { TaskDefinitionRepository } from "./task-definition.repository.js";

export class TaskDefinitionService {
  constructor(
    private readonly repository: TaskDefinitionRepository,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly publish?: (
      type: string,
      data: Record<string, unknown>,
    ) => Promise<void>,
  ) {}

  async list(projectId: string): Promise<TaskDefinition[]> {
    this.getProject(projectId);
    return this.repository.list(projectId);
  }

  async get(projectId: string, definitionId: string): Promise<TaskDefinition> {
    const definition = (await this.list(projectId)).find(
      (item) => item.id === definitionId,
    );
    if (!definition) throw this.notFound();
    return definition;
  }

  async create(
    projectId: string,
    request: CreateTaskDefinitionRequest,
  ): Promise<TaskDefinition> {
    this.getProject(projectId);
    const now = new Date().toISOString();
    const definition: TaskDefinition = {
      id: createId("taskdef"),
      scope: { kind: "project", projectId },
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      runPolicy: request.runPolicy,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.replace(projectId, [
      ...(await this.repository.list(projectId)),
      definition,
    ]);
    await this.publish?.("taskDefinition.created", { definition });
    return definition;
  }

  async update(
    projectId: string,
    definitionId: string,
    request: UpdateTaskDefinitionRequest,
  ): Promise<TaskDefinition> {
    const existing = await this.list(projectId);
    const index = existing.findIndex((item) => item.id === definitionId);
    const current = existing[index];
    if (!current) throw this.notFound();
    const updated: TaskDefinition = {
      ...current,
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      runPolicy: request.runPolicy,
      updatedAt: new Date().toISOString(),
    };
    const next = [...existing];
    next[index] = updated;
    await this.repository.replace(projectId, next);
    await this.publish?.("taskDefinition.updated", { definition: updated });
    return updated;
  }

  async remove(projectId: string, definitionId: string): Promise<void> {
    const existing = await this.list(projectId);
    const next = existing.filter((item) => item.id !== definitionId);
    if (next.length === existing.length) throw this.notFound();
    await this.repository.replace(projectId, next);
    await this.publish?.("taskDefinition.deleted", { definitionId });
  }

  private notFound(): ApplicationError {
    return new ApplicationError(
      404,
      "TASK_DEFINITION_NOT_FOUND",
      "Task definition not found.",
    );
  }
}
