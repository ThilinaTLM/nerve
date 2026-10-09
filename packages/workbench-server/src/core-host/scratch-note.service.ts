import { createId } from "@nervekit/contracts";
import {
  SCRATCH_NOTE_DEFAULT_TITLE,
  type CreateScratchNoteRequest,
  type UpdateScratchNoteRequest,
} from "@nervekit/contracts/scratch-notes";
import type { CoreStorage } from "@nervekit/conversation-core";

export class CoreScratchNoteService {
  constructor(
    private readonly storage: CoreStorage,
    private readonly changed: (projectId: string) => Promise<void>,
  ) {}
  private assertProject(projectId: string) {
    if (!this.storage.projects.get(projectId))
      throw new Error("Project not found");
  }
  private note(projectId: string, noteId: string) {
    this.assertProject(projectId);
    const note = this.storage.scratchNotes.get(noteId);
    if (!note || note.projectId !== projectId)
      throw new Error("Scratch note not found");
    return note;
  }
  async list(projectId: string) {
    this.assertProject(projectId);
    return this.storage.scratchNotes.list(projectId);
  }
  async create(projectId: string, request: CreateScratchNoteRequest) {
    this.assertProject(projectId);
    const now = new Date().toISOString();
    const note = this.storage.scratchNotes.insert({
      id: createId("note"),
      projectId,
      title: request.title ?? SCRATCH_NOTE_DEFAULT_TITLE,
      content: request.content ?? "",
      createdAt: now,
      updatedAt: now,
    });
    await this.changed(projectId);
    return note;
  }
  async update(
    projectId: string,
    noteId: string,
    request: UpdateScratchNoteRequest,
  ) {
    this.note(projectId, noteId);
    const note = this.storage.scratchNotes.update(noteId, {
      ...request,
      updatedAt: new Date().toISOString(),
    });
    await this.changed(projectId);
    return note;
  }
  async remove(projectId: string, noteId: string) {
    this.note(projectId, noteId);
    this.storage.scratchNotes.delete(noteId);
    await this.changed(projectId);
  }
}
