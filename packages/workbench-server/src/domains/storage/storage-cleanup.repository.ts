import {
  type StorageCleanupOperation,
  storageCleanupOperationSchema,
} from "@nervekit/contracts";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

export class StorageCleanupRepository {
  constructor(readonly path: string) {}

  async read(): Promise<StorageCleanupOperation | null> {
    if (!(await pathExists(this.path))) return null;
    const raw = await readJsonFile<unknown>(this.path).catch(() => undefined);
    const parsed = storageCleanupOperationSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async write(operation: StorageCleanupOperation): Promise<void> {
    const validated = storageCleanupOperationSchema.parse(operation);
    await atomicWriteJson(this.path, validated, 0o600);
  }
}
