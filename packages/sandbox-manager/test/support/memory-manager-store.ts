import {
  type ManagedSandboxRecord,
  managedSandboxRecordSchema,
} from "@nervekit/contracts";
import type { ManagerStore } from "../../src/state/manager-store.js";

/**
 * In-memory `ManagerStore` for unit tests. Records are validated and cloned on
 * write and read so tests observe the same value semantics as the production
 * PostgreSQL store without any filesystem or database I/O.
 */
export class MemoryManagerStore implements ManagerStore {
  private readonly records = new Map<string, ManagedSandboxRecord>();

  async list(): Promise<ManagedSandboxRecord[]> {
    return Array.from(this.records.values())
      .sort((a, b) => a.sandboxId.localeCompare(b.sandboxId))
      .map(clone);
  }

  async get(sandboxId: string): Promise<ManagedSandboxRecord | undefined> {
    const record = this.records.get(sandboxId);
    return record ? clone(record) : undefined;
  }

  async put(record: ManagedSandboxRecord): Promise<void> {
    const parsed = managedSandboxRecordSchema.parse(record);
    this.records.set(parsed.sandboxId, parsed);
  }

  async delete(sandboxId: string): Promise<void> {
    this.records.delete(sandboxId);
  }
}

function clone(record: ManagedSandboxRecord): ManagedSandboxRecord {
  return structuredClone(record);
}
