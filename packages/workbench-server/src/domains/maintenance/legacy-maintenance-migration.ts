import { z } from "zod";
import {
  maintenanceOperationSchema,
  type MaintenanceOperation,
} from "@nervekit/contracts/maintenance";
import {
  projectRecordSchema,
  pruneProjectConversationsRequestSchema,
} from "@nervekit/contracts/projects";
import {
  storageCleanupRequestSchema,
  storageCleanupResultSchema,
} from "@nervekit/contracts/storage";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
const count = z.number().int().nonnegative().default(0);
const legacySchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: z.enum([
    "queued",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  message: z.string(),
  error: z.string().optional(),
  kind: z.enum(["prune_conversations", "delete_project"]).optional(),
  project: projectRecordSchema.optional(),
  pruneRequest: pruneProjectConversationsRequestSchema.optional(),
  request: storageCleanupRequestSchema.optional(),
  results: z.array(storageCleanupResultSchema).default([]),
  completedItems: count,
  totalItems: count.optional(),
  completedTargets: count,
  totalTargets: count,
  removedConversationCount: count,
  removedTaskCount: count,
  skippedActiveAgentCount: count,
  skippedActiveTaskCount: count,
  freedBytes: count,
});
export async function migrateLegacyMaintenance(
  store: CanonicalStore,
): Promise<MaintenanceOperation | null> {
  const candidates: MaintenanceOperation[] = [];
  for (const documentId of ["storage-cleanup", "project-maintenance"]) {
    const document = await store.readDocument(
      "maintenance",
      "global",
      documentId,
    );
    const parsed = legacySchema.safeParse(document?.data);
    if (!parsed.success) continue;
    const old = parsed.data;
    const kind = old.kind ?? "storage_cleanup";
    const request =
      kind === "storage_cleanup"
        ? { kind, parameters: old.request }
        : kind === "prune_conversations"
          ? { kind, projectId: old.project?.id, parameters: old.pruneRequest }
          : { kind, projectId: old.project?.id };
    const active = ["queued", "running", "cancelling"].includes(old.status);
    const converted = maintenanceOperationSchema.safeParse({
      ...old,
      kind,
      request,
      revision: 1,
      cancellable: false,
      cancellationRequested: false,
      phase: active ? "interrupted" : "completed",
      status: active ? "failed" : old.status,
      completedAt: active ? new Date().toISOString() : old.completedAt,
      error: active
        ? "The daemon stopped before cleanup completed."
        : old.error,
      warnings: old.results
        .filter((result) => result.error)
        .map((result) => result.error!),
      result:
        kind === "storage_cleanup"
          ? { kind, targets: old.results }
          : kind === "prune_conversations"
            ? {
                kind,
                removedConversationCount: old.removedConversationCount,
                removedTaskCount: old.removedTaskCount,
              }
            : {
                kind,
                projectId: old.project?.id,
                removedConversationCount: old.removedConversationCount,
              },
    });
    if (converted.success) candidates.push(converted.data);
  }
  return (
    candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}
