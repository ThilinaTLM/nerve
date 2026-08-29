import { type TaskRecord, taskRecordSchema } from "@nervekit/contracts";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import { TaskLogBundleStore } from "./task-log-bundle.store.js";

export class TaskRepository {
  readonly bundles: TaskLogBundleStore;

  constructor(private readonly storage: InitializedStorage) {
    this.bundles = new TaskLogBundleStore(storage.paths.tasksPath);
  }

  get storageHome(): string {
    return this.storage.paths.home;
  }

  async hydrate(): Promise<TaskRecord[]> {
    const documents = await this.storage.canonicalStore.listDocuments<unknown>(
      "task",
      "global",
    );
    const output: TaskRecord[] = [];
    for (const document of documents) {
      const parsed = taskRecordSchema.parse(document.data);
      const legacy = parsed.logsPath.endsWith(".logs.jsonl");
      if (legacy) await this.bundles.migrateLegacy(parsed.id);
      else await this.bundles.initializeTask(parsed.id);
      const materialized = this.materialize(parsed, legacy);
      if (legacy) await this.write(materialized);
      output.push(materialized);
    }
    await this.bundles.reconcile(new Set(output.map((record) => record.id)));
    return output;
  }

  async write(record: TaskRecord): Promise<void> {
    const parsed = taskRecordSchema.parse(record);
    await this.bundles.initializeTask(parsed.id);
    const persisted = {
      ...parsed,
      stdoutPath: `tasks/${parsed.id}/stdout.txt`,
      stderrPath: `tasks/${parsed.id}/stderr.txt`,
      combinedPath: parsed.combinedPath
        ? `tasks/${parsed.id}/combined.txt`
        : undefined,
      logsPath: `tasks/${parsed.id}/events.jsonl`,
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
    // The live record disappears before the complete bundle is tombstoned.
    await this.storage.canonicalStore.deleteDocument("task", "global", taskId);
    await this.bundles.remove(taskId);
  }

  private materialize(record: TaskRecord, reconstructed = false): TaskRecord {
    const paths = this.bundles.paths(record.id);
    return taskRecordSchema.parse({
      ...record,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
      combinedPath: reconstructed ? undefined : paths.combinedPath,
      logsPath: paths.eventsPath,
      outputRetention: record.outputRetention
        ? { ...record.outputRetention, tailPath: undefined }
        : undefined,
    });
  }

  logsPath(taskId: string): string {
    return this.bundles.paths(taskId).eventsPath;
  }

  paths(taskId: string) {
    return this.bundles.paths(taskId);
  }
}
