import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile } from "../../infrastructure/storage/json.js";
import { type TaskRecord, taskRecordSchema } from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

export class TaskRepository {
  constructor(private readonly storage: InitializedStorage) {}

  get storageHome(): string {
    return this.storage.paths.home;
  }

  async hydrate(): Promise<TaskRecord[]> {
    const canonical = (
      await this.storage.canonicalStore.listDocuments<unknown>("task", "global")
    ).map((document) => taskRecordSchema.parse(document.data));
    if (canonical.length > 0) return canonical;
    // One-time direct import for isolated repository consumers and interrupted
    // upgrades. Normal startup imports these before repository composition.
    const directories = await readdir(join(this.storage.paths.home, "tasks"), {
      withFileTypes: true,
    }).catch(() => []);
    const imported: TaskRecord[] = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const parsed = taskRecordSchema.safeParse(
        await readJsonFile<unknown>(
          join(this.storage.paths.home, "tasks", directory.name, "task.json"),
        ).catch(() => undefined),
      );
      if (!parsed.success) continue;
      await this.write(parsed.data);
      imported.push(parsed.data);
    }
    return imported;
  }

  async write(record: TaskRecord): Promise<void> {
    const parsed = taskRecordSchema.parse(record);
    const current = await this.storage.canonicalStore.readDocument(
      "task",
      "global",
      parsed.id,
    );
    await this.storage.canonicalStore.writeDocument({
      namespace: "task",
      scopeId: "global",
      documentId: parsed.id,
      data: parsed,
      expectedRevision: current?.revision ?? 0,
      now: parsed.updatedAt,
    });
  }

  async remove(taskId: string): Promise<void> {
    await this.storage.canonicalStore.deleteDocument("task", "global", taskId);
    await rm(this.taskDir(taskId), { recursive: true, force: true });
  }

  /** External process logs and task artifacts intentionally remain files. */
  taskDir(taskId: string): string {
    return join(this.storage.paths.home, "tasks", taskId);
  }
}
