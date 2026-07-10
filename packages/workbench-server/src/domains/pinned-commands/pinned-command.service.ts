import {
  type CreatePinnedCommandRequest,
  createId,
  type PinnedCommand,
  type ProjectRecord,
  type UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import { HttpError } from "../../http/errors.js";
import type { PinnedCommandRepository } from "./pinned-command.repository.js";

export class PinnedCommandService {
  constructor(
    private readonly repository: PinnedCommandRepository,
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  async list(projectId: string): Promise<PinnedCommand[]> {
    this.getProject(projectId);
    return this.repository.list(projectId);
  }

  async create(
    projectId: string,
    request: CreatePinnedCommandRequest,
  ): Promise<PinnedCommand> {
    this.getProject(projectId);
    const now = new Date().toISOString();
    const record: PinnedCommand = {
      id: createId("pin"),
      projectId,
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      createdAt: now,
      updatedAt: now,
    };
    const existing = await this.repository.list(projectId);
    await this.repository.replace(projectId, [...existing, record]);
    return record;
  }

  async update(
    projectId: string,
    commandId: string,
    request: UpdatePinnedCommandRequest,
  ): Promise<PinnedCommand> {
    this.getProject(projectId);
    const existing = await this.repository.list(projectId);
    const index = existing.findIndex((command) => command.id === commandId);
    if (index === -1) throw this.notFound();

    const current = existing[index];
    if (!current) throw this.notFound();
    const updated: PinnedCommand = {
      ...current,
      ...(request.label ? { label: request.label } : { label: undefined }),
      command: request.command,
      ...(request.cwd ? { cwd: request.cwd } : { cwd: undefined }),
      updatedAt: new Date().toISOString(),
    };
    const next = [...existing];
    next[index] = updated;
    await this.repository.replace(projectId, next);
    return updated;
  }

  async remove(projectId: string, commandId: string): Promise<void> {
    this.getProject(projectId);
    const existing = await this.repository.list(projectId);
    const filtered = existing.filter((command) => command.id !== commandId);
    if (filtered.length === existing.length) throw this.notFound();
    await this.repository.replace(projectId, filtered);
  }

  private notFound(): HttpError {
    return new HttpError(
      404,
      "PINNED_COMMAND_NOT_FOUND",
      "Pinned command not found.",
    );
  }
}
