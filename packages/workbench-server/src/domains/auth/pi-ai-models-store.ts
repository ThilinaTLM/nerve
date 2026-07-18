import type { ModelsStore, ModelsStoreEntry } from "@earendil-works/pi-ai";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../infrastructure/storage/json.js";

type StoredCatalogs = Record<string, ModelsStoreEntry>;

/** Atomic non-secret cache for dynamic pi-ai provider catalogs. */
export class PiAiModelsStore implements ModelsStore {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    const catalogs = await this.readAll();
    const entry = catalogs[providerId];
    return entry ? structuredClone(entry) : undefined;
  }

  write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    return this.serialized(async () => {
      const catalogs = await this.readAll();
      catalogs[providerId] = structuredClone(entry);
      await atomicWriteJson(this.path, catalogs, 0o600);
    });
  }

  delete(providerId: string): Promise<void> {
    return this.serialized(async () => {
      const catalogs = await this.readAll();
      delete catalogs[providerId];
      await atomicWriteJson(this.path, catalogs, 0o600);
    });
  }

  private async readAll(): Promise<StoredCatalogs> {
    if (!(await pathExists(this.path))) return {};
    const value = await readJsonFile<unknown>(this.path).catch(() => undefined);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as StoredCatalogs;
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
