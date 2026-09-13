import { join } from "node:path";
import type { ConversationHarnessStorage } from "../../../domains/conversations/conversation-harness-storage.js";
import { CanonicalAuthorityPromotionService } from "../../../domains/storage/canonical-authority-promotion.service.js";
import type { CanonicalStore } from "../../persistence/canonical-sqlite/canonical-store.js";
import type { StoragePaths } from "../../storage-bootstrap/index.js";
import { extractExactHarnessMessages } from "./extract-exact-harness-messages.js";
import {
  migrateCurrentHomeConversationTimelines,
  readRetainedTimelineMigrationProofs,
  retireMigratedLegacyRuntimeAuthority,
} from "./migrate-current-home-timelines.js";

/**
 * Offline-only bridge for the final promotion coordinator. This is the sole
 * module allowed to understand both the retired harness journal and canonical
 * migration input.
 */
export async function migrateLiveJournalToCanonical(input: {
  store: CanonicalStore;
  paths: StoragePaths;
  legacyHarness: ConversationHarnessStorage;
  importedAt: string;
  runtimeIsolation: "proven";
}) {
  const admission = await input.store.disableTimelineRuntimeAdmission(
    input.importedAt,
  );
  if (admission.dispatchState !== "disabled") {
    throw new Error("Canonical dispatch admission could not be fenced.");
  }
  return migrateCurrentHomeConversationTimelines({
    store: input.store,
    proofDirectory: join(
      input.paths.migrationsPath,
      "unified-conversation-timeline",
    ),
    importedAt: input.importedAt,
    runtimeIsolation: input.runtimeIsolation,
    readExactMessages: async (conversationId) =>
      extractExactHarnessMessages(
        await input.legacyHarness.modelEntries(conversationId),
      ),
  });
}

/** Final offline conversion, retirement, and atomic admission boundary. */
export async function promoteLiveJournalToCanonical(input: {
  store: CanonicalStore;
  paths: StoragePaths;
  legacyHarness: ConversationHarnessStorage;
  promotedAt: string;
  runtimeIsolation: "proven";
}) {
  const legacyAuthorityCount =
    await input.store.migration.countLegacyRuntimeAuthority();
  const proofDirectory = join(
    input.paths.migrationsPath,
    "unified-conversation-timeline",
  );
  const proofs =
    legacyAuthorityCount === 0
      ? await readRetainedTimelineMigrationProofs(proofDirectory)
      : await migrateLiveJournalToCanonical({
          ...input,
          importedAt: input.promotedAt,
        });
  if (!proofs) {
    throw new Error("Retired legacy authority has no migration proofs.");
  }
  const retiredLegacyRows =
    legacyAuthorityCount === 0
      ? 0
      : await retireMigratedLegacyRuntimeAuthority(input.store);
  const promotion = await new CanonicalAuthorityPromotionService(
    input.store,
  ).promote({
    manifestPath: join(proofDirectory, "manifest.json"),
    oldRuntimeIsolation: input.runtimeIsolation,
    promotedAt: input.promotedAt,
  });
  return { proofs, retiredLegacyRows, promotion };
}
