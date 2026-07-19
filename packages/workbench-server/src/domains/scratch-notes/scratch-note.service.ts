import {
  type CreateScratchNoteRequest,
  createId,
  type ProjectRecord,
  SCRATCH_NOTE_DEFAULT_TITLE,
  type ScratchNote,
  type UpdateScratchNoteRequest,
} from "@nervekit/contracts";
import { HttpError } from "../../http/errors.js";
import type { ScratchNoteRepository } from "./scratch-note.repository.js";

export class ScratchNoteService {
  private readonly mutationTails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly repository: ScratchNoteRepository,
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  async list(projectId: string): Promise<ScratchNote[]> {
    this.getProject(projectId);
    return this.repository.list(projectId);
  }

  async create(
    projectId: string,
    request: CreateScratchNoteRequest,
  ): Promise<ScratchNote> {
    this.getProject(projectId);
    return this.mutate(projectId, async () => {
      const now = new Date().toISOString();
      const note: ScratchNote = {
        id: createId("note"),
        projectId,
        title: request.title ?? SCRATCH_NOTE_DEFAULT_TITLE,
        content: request.content ?? "",
        createdAt: now,
        updatedAt: now,
      };
      const existing = await this.repository.list(projectId);
      await this.repository.replace(projectId, [...existing, note]);
      return note;
    });
  }

  async update(
    projectId: string,
    noteId: string,
    request: UpdateScratchNoteRequest,
  ): Promise<ScratchNote> {
    this.getProject(projectId);
    return this.mutate(projectId, async () => {
      const existing = await this.repository.list(projectId);
      const index = existing.findIndex((note) => note.id === noteId);
      const current = existing[index];
      if (!current) throw this.notFound();

      const updated: ScratchNote = {
        ...current,
        ...(request.title !== undefined ? { title: request.title } : {}),
        ...(request.content !== undefined ? { content: request.content } : {}),
        updatedAt: new Date().toISOString(),
      };
      const next = [...existing];
      next[index] = updated;
      await this.repository.replace(projectId, next);
      return updated;
    });
  }

  async remove(projectId: string, noteId: string): Promise<void> {
    this.getProject(projectId);
    await this.mutate(projectId, async () => {
      const existing = await this.repository.list(projectId);
      const filtered = existing.filter((note) => note.id !== noteId);
      if (filtered.length === existing.length) throw this.notFound();
      await this.repository.replace(projectId, filtered);
    });
  }

  private async mutate<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationTails.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.mutationTails.set(projectId, next);
    try {
      return await next;
    } finally {
      if (this.mutationTails.get(projectId) === next) {
        this.mutationTails.delete(projectId);
      }
    }
  }

  private notFound(): HttpError {
    return new HttpError(
      404,
      "SCRATCH_NOTE_NOT_FOUND",
      "Scratch note not found.",
    );
  }
}
