import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type PinnedCommand, pinnedCommandSchema } from "@nerve/shared";
import {
  atomicWriteJson,
  type InitializedStorage,
  readJsonFile,
} from "../storage.js";

export class PinnedCommandRepository {
  constructor(private readonly storage: InitializedStorage) {}

  private file(projectId: string): string {
    return join(
      this.storage.paths.home,
      "projects",
      projectId,
      "pinned-commands.json",
    );
  }

  async list(projectId: string): Promise<PinnedCommand[]> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      () => undefined,
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .map((value) => pinnedCommandSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data);
  }

  async replace(projectId: string, commands: PinnedCommand[]): Promise<void> {
    const path = this.file(projectId);
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await atomicWriteJson(path, commands, 0o600);
  }
}
