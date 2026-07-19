import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createId,
  SCRATCH_NOTE_DEFAULT_TITLE,
  type ScratchNote,
  scratchNoteSchema,
} from "@nervekit/contracts";
import { z } from "zod";
import {
  atomicWriteJson,
  type InitializedStorage,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

const legacyScratchNoteSchema = z.object({
  content: z.string(),
  updatedAt: z.string().datetime(),
});

export class ScratchNoteRepository {
  constructor(private readonly storage: InitializedStorage) {}

  private file(projectId: string): string {
    return join(
      this.storage.paths.home,
      "projects",
      projectId,
      "scratch-notes.json",
    );
  }

  private legacyFile(projectId: string): string {
    return join(
      this.storage.paths.home,
      "projects",
      projectId,
      "scratch-note.json",
    );
  }

  async list(projectId: string): Promise<ScratchNote[]> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      () => undefined,
    );
    if (raw !== undefined) {
      if (!Array.isArray(raw)) return [];
      return raw
        .map((value) => scratchNoteSchema.safeParse(value))
        .filter((result) => result.success)
        .map((result) => result.data);
    }

    return this.migrateLegacy(projectId);
  }

  async replace(projectId: string, notes: ScratchNote[]): Promise<void> {
    const path = this.file(projectId);
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await atomicWriteJson(path, notes, 0o600);
  }

  private async migrateLegacy(projectId: string): Promise<ScratchNote[]> {
    const legacyPath = this.legacyFile(projectId);
    const raw = await readJsonFile<unknown>(legacyPath).catch(() => undefined);
    const legacy = legacyScratchNoteSchema.safeParse(raw);
    const notes: ScratchNote[] =
      legacy.success && legacy.data.content.length > 0
        ? [
            {
              id: createId("note"),
              projectId,
              title: SCRATCH_NOTE_DEFAULT_TITLE,
              content: legacy.data.content,
              createdAt: legacy.data.updatedAt,
              updatedAt: legacy.data.updatedAt,
            },
          ]
        : [];

    await this.replace(projectId, notes);
    if (raw !== undefined) await rm(legacyPath, { force: true });
    return notes;
  }
}
