import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ManagedSandboxRecord,
  managedSandboxRecordSchema,
} from "@nervekit/shared";

export interface ManagerStore {
  list(): Promise<ManagedSandboxRecord[]>;
  get(sandboxId: string): Promise<ManagedSandboxRecord | undefined>;
  put(record: ManagedSandboxRecord): Promise<void>;
  delete(sandboxId: string): Promise<void>;
}

export class FileManagerStore implements ManagerStore {
  private readonly recordsPath: string;

  constructor(readonly rootDir: string) {
    this.recordsPath = path.join(rootDir, "sandboxes.json");
  }

  async list(): Promise<ManagedSandboxRecord[]> {
    return Array.from((await this.readAll()).values()).sort((a, b) =>
      a.sandboxId.localeCompare(b.sandboxId),
    );
  }

  async get(sandboxId: string): Promise<ManagedSandboxRecord | undefined> {
    return (await this.readAll()).get(sandboxId);
  }

  async put(record: ManagedSandboxRecord): Promise<void> {
    const parsed = managedSandboxRecordSchema.parse(record);
    const records = await this.readAll();
    records.set(parsed.sandboxId, parsed);
    await this.writeAll(records);
  }

  async delete(sandboxId: string): Promise<void> {
    const records = await this.readAll();
    records.delete(sandboxId);
    await this.writeAll(records);
  }

  private async readAll(): Promise<Map<string, ManagedSandboxRecord>> {
    try {
      const raw = await readFile(this.recordsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed))
        throw new Error("manager store must contain an array");
      return new Map(
        parsed.map((record) => {
          const managed = managedSandboxRecordSchema.parse(record);
          return [managed.sandboxId, managed] as const;
        }),
      );
    } catch (error) {
      if (isNotFound(error)) return new Map();
      throw error;
    }
  }

  private async writeAll(
    records: Map<string, ManagedSandboxRecord>,
  ): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const tempPath = `${this.recordsPath}.${process.pid}.tmp`;
    const body = `${JSON.stringify(Array.from(records.values()), null, 2)}\n`;
    await writeFile(tempPath, body, "utf8");
    await rename(tempPath, this.recordsPath);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
