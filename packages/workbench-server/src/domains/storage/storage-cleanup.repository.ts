import {
  type StorageCleanupOperation,
  storageCleanupOperationSchema,
} from "@nervekit/contracts/storage";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";

const NAMESPACE = "maintenance";
const SCOPE = "global";
const DOCUMENT = "storage-cleanup";

export class StorageCleanupRepository {
  constructor(private readonly store: CanonicalStore) {}

  async read(): Promise<StorageCleanupOperation | null> {
    const document = await this.store.readDocument<unknown>(
      NAMESPACE,
      SCOPE,
      DOCUMENT,
    );
    const parsed = storageCleanupOperationSchema.safeParse(document?.data);
    return parsed.success ? parsed.data : null;
  }

  async write(operation: StorageCleanupOperation): Promise<void> {
    const validated = storageCleanupOperationSchema.parse(operation);
    const current = await this.store.readDocument(NAMESPACE, SCOPE, DOCUMENT);
    await this.store.writeDocument({
      namespace: NAMESPACE,
      scopeId: SCOPE,
      documentId: DOCUMENT,
      data: validated,
      expectedRevision: current?.revision ?? 0,
    });
  }
}
