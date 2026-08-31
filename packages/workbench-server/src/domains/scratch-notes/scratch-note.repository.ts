import {
  type ScratchNote,
  scratchNoteSchema,
} from "@nervekit/contracts/scratch-notes";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";

export class ScratchNoteRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async list(projectId: string): Promise<ScratchNote[]> {
    const document = await this.storage.canonicalStore.readDocument<unknown>(
      "scratch_notes",
      projectId,
      "notes",
    );
    if (!Array.isArray(document?.data)) return [];
    return document.data.map((note) => scratchNoteSchema.parse(note));
  }

  async replace(projectId: string, notes: ScratchNote[]): Promise<void> {
    const parsed = notes.map((note) => scratchNoteSchema.parse(note));
    const current = await this.storage.canonicalStore.readDocument(
      "scratch_notes",
      projectId,
      "notes",
    );
    await this.storage.canonicalStore.writeDocument({
      namespace: "scratch_notes",
      scopeId: projectId,
      documentId: "notes",
      data: parsed,
      expectedRevision: current?.revision ?? 0,
    });
  }
}
