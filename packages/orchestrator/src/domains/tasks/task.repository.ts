import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type TaskRecord, taskRecordSchema } from "@nervekit/contracts";

export type LegacyProcessRecord = {
  id: string;
  name?: string;
  workerId?: string;
  projectId?: string;
  conversationId?: string;
  agentId?: string;
  cwd: string;
  command: string;
  envInfo?: TaskRecord["envInfo"];
  status?: string;
  readiness?: TaskRecord["readiness"];
  stdoutPath?: string;
  stderrPath?: string;
  logsPath?: string;
  startedAt?: string;
  updatedAt?: string;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
  runtime?: TaskRecord["runtime"];
};

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

  async hydrateLegacyProcesses(): Promise<LegacyProcessRecord[]> {
    const records: LegacyProcessRecord[] = [];
    const root = join(this.storage.paths.home, "proc");
    for (const processId of await listChildDirs(root)) {
      const raw = await readJsonFile<unknown>(
        join(root, processId, "process.json"),
      ).catch(() => undefined);
      if (!raw || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        !record.id.startsWith("proc_") ||
        typeof record.cwd !== "string" ||
        typeof record.command !== "string"
      ) {
        continue;
      }
      records.push(record as LegacyProcessRecord);
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

  async removeLegacyProcess(processId: string): Promise<void> {
    await rm(join(this.storage.paths.home, "proc", processId), {
      recursive: true,
      force: true,
    });
  }

  taskDir(taskId: string): string {
    return join(this.storage.paths.home, "tasks", taskId);
  }
}
