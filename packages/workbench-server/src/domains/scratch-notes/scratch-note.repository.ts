import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ScratchNote, scratchNoteSchema } from "@nervekit/contracts";
import {
  atomicWriteJson,
  type InitializedStorage,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

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

  async list(projectId: string): Promise<ScratchNote[]> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      () => undefined,
    );
    if (!Array.isArray(raw)) return [];
    return raw.map((value) => scratchNoteSchema.parse(value));
  }

  async replace(projectId: string, notes: ScratchNote[]): Promise<void> {
    const path = this.file(projectId);
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await atomicWriteJson(path, notes, 0o600);
  }
}
