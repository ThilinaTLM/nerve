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
      "scratch-note.json",
    );
  }

  async get(projectId: string): Promise<ScratchNote> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      () => undefined,
    );
    const parsed = scratchNoteSchema.safeParse(
      raw && typeof raw === "object" ? { ...raw, projectId } : undefined,
    );
    if (parsed.success) return parsed.data;
    return {
      projectId,
      content: "",
      updatedAt: new Date(0).toISOString(),
    };
  }

  async replace(projectId: string, note: ScratchNote): Promise<void> {
    const path = this.file(projectId);
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await atomicWriteJson(path, note, 0o600);
  }
}
