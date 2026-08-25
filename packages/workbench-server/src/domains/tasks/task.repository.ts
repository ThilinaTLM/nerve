import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type TaskRecord, taskRecordSchema } from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

export class TaskRepository {
  constructor(private readonly storage: InitializedStorage) {}

  get storageHome(): string {
    return this.storage.paths.home;
  }

  async hydrate(): Promise<TaskRecord[]> {
    return (
      await this.storage.canonicalStore.listDocuments<unknown>("task", "global")
    ).map((document) =>
      this.materialize(taskRecordSchema.parse(document.data)),
    );
  }

  async write(record: TaskRecord): Promise<void> {
    const parsed = taskRecordSchema.parse(record);
    const logicalPath = `tasks/${parsed.id}.logs.jsonl`;
    const persisted = {
      ...parsed,
      stdoutPath: logicalPath,
      stderrPath: logicalPath,
      combinedPath: logicalPath,
      logsPath: logicalPath,
      outputRetention: parsed.outputRetention
        ? { ...parsed.outputRetention, tailPath: undefined }
        : undefined,
    };
    const current = await this.storage.canonicalStore.readDocument(
      "task",
      "global",
      parsed.id,
    );
    await this.storage.canonicalStore.writeDocument({
      namespace: "task",
      scopeId: "global",
      documentId: parsed.id,
      data: persisted,
      expectedRevision: current?.revision ?? 0,
      now: parsed.updatedAt,
    });
  }

  async remove(taskId: string): Promise<void> {
    await this.storage.canonicalStore.deleteDocument("task", "global", taskId);
    await rm(this.logsPath(taskId), { force: true });
  }

  private materialize(record: TaskRecord): TaskRecord {
    const path = this.logsPath(record.id);
    return taskRecordSchema.parse({
      ...record,
      stdoutPath: path,
      stderrPath: path,
      combinedPath: path,
      logsPath: path,
      outputRetention: record.outputRetention
        ? { ...record.outputRetention, tailPath: undefined }
        : undefined,
    });
  }

  logsPath(taskId: string): string {
    if (!/^task_[A-Za-z0-9_-]+$/.test(taskId))
      throw new Error("Invalid task ID.");
    return join(this.storage.paths.tasksPath, `${taskId}.logs.jsonl`);
  }
}
