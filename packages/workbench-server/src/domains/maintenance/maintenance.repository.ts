import {
  maintenanceOperationSchema,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { migrateLegacyMaintenance } from "./legacy-maintenance-migration.js";
export class MaintenanceRepository {
  constructor(private readonly store: CanonicalStore) {}
  async read(): Promise<MaintenanceOperation | null> {
    const document = await this.store.readDocument(
      "maintenance",
      "global",
      "latest-operation",
    );
    let operation = document
      ? maintenanceOperationSchema.parse(document.data)
      : await migrateLegacyMaintenance(this.store);
    if (operation) {
      if (!document) {
        await this.write(operation);
        operation = structuredClone(operation);
      }
      for (const id of ["storage-cleanup", "project-maintenance"])
        await this.store.deleteDocument("maintenance", "global", id);
    }
    return operation;
  }
  async write(operation: MaintenanceOperation): Promise<void> {
    const current = await this.store.readDocument(
      "maintenance",
      "global",
      "latest-operation",
    );
    await this.store.writeDocument({
      namespace: "maintenance",
      scopeId: "global",
      documentId: "latest-operation",
      data: maintenanceOperationSchema.parse(operation),
      expectedRevision: current?.revision ?? 0,
    });
  }
}
