import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type ProcessRecord, processRecordSchema } from "@nerve/shared";
import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

export class ProcessRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async hydrate(): Promise<ProcessRecord[]> {
    const records: ProcessRecord[] = [];
    const root = join(this.storage.paths.home, "proc");
    for (const processId of await listChildDirs(root)) {
      const parsed = processRecordSchema.safeParse(
        await readJsonFile<unknown>(
          join(root, processId, "process.json"),
        ).catch(() => undefined),
      );
      if (!parsed.success) continue;
      records.push(parsed.data);
    }
    return records;
  }

  async write(record: ProcessRecord): Promise<void> {
    await atomicWriteJson(
      join(this.processDir(record.id), "process.json"),
      record,
      0o600,
    );
  }

  async remove(processId: string): Promise<void> {
    await rm(this.processDir(processId), { recursive: true, force: true });
  }

  processDir(processId: string): string {
    return join(this.storage.paths.home, "proc", processId);
  }
}
