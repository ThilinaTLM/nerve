import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type TaskRecord, taskRecordSchema } from "@nervekit/contracts";

import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

export class TaskRepository {
  constructor(private readonly storage: InitializedStorage) {}

  get storageHome(): string {
    return this.storage.paths.home;
  }

  async hydrate(): Promise<TaskRecord[]> {
    const records: TaskRecord[] = [];
    const root = join(this.storage.paths.home, "tasks");
    for (const taskId of await listChildDirs(root)) {
      const parsed = taskRecordSchema.safeParse(
        await readJsonFile<unknown>(join(root, taskId, "task.json")).catch(
          () => undefined,
        ),
      );
      if (!parsed.success) continue;
      records.push(parsed.data);
    }
    return records;
  }

  async write(record: TaskRecord): Promise<void> {
    await atomicWriteJson(
      join(this.taskDir(record.id), "task.json"),
      record,
      0o600,
    );
  }

  async remove(taskId: string): Promise<void> {
    await rm(this.taskDir(taskId), { recursive: true, force: true });
  }

  taskDir(taskId: string): string {
    return join(this.storage.paths.home, "tasks", taskId);
  }
}
