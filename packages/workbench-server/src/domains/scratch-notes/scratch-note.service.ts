import type {
  ProjectRecord,
  ScratchNote,
  UpdateScratchNoteRequest,
} from "@nervekit/contracts";
import type { ScratchNoteRepository } from "./scratch-note.repository.js";

export class ScratchNoteService {
  constructor(
    private readonly repository: ScratchNoteRepository,
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  async get(projectId: string): Promise<ScratchNote> {
    this.getProject(projectId);
    return this.repository.get(projectId);
  }

  async update(
    projectId: string,
    request: UpdateScratchNoteRequest,
  ): Promise<ScratchNote> {
    this.getProject(projectId);
    const note: ScratchNote = {
      projectId,
      content: request.content,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.replace(projectId, note);
    return note;
  }
}
