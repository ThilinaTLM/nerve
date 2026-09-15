import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ConversationHarnessStorage } from "../legacy-journal/conversation-harness-storage.js";
import { ConversationJournalRepository } from "../legacy-journal/conversation-journal.repository.js";
import { ConversationRepository } from "../legacy-journal/conversation.repository.js";
import { CanonicalTimelineIdentityService } from "../../../domains/conversations/timeline/canonical-timeline-identity.service.js";
import { CanonicalPortableBackupService } from "../../../domains/storage/canonical-portable-backup.service.js";
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
  reportProgress?: (message: string) => void;
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
    readExactMessages: async (conversationId, includedEntryIds) =>
      extractExactHarnessMessages(
        await input.legacyHarness.modelEntries(conversationId),
        includedEntryIds,
      ),
    reportProgress: input.reportProgress,
  });
}

/** Runs the mandatory current-home cutover while startup still owns isolation. */
export async function promoteCurrentHomeAtStartup(input: {
  store: CanonicalStore;
  paths: StoragePaths;
  promotedAt: string;
  reportProgress?: (message: string) => void;
}) {
  const legacyCount = await input.store.migration.countLegacyRuntimeAuthority();
  if (legacyCount === 0) return undefined;
  await new CanonicalTimelineIdentityService(input.store).resolve();
  const proofDirectory = join(
    input.paths.migrationsPath,
    "unified-conversation-timeline",
  );
  if (await hasConversationMigrationProof(proofDirectory)) {
    input.reportProgress?.(
      "Resuming migration from the last completed conversation",
    );
  } else {
    input.reportProgress?.("Creating a safety backup before migration");
    await new CanonicalPortableBackupService(input.store, input.paths).create(
      input.promotedAt,
      input.reportProgress,
    );
  }
  const journal = new ConversationJournalRepository({
    paths: input.paths,
    canonicalStore: input.store,
  });
  const metadata = await journal.listConversationMetadata();
  const byId = new Map(
    metadata.map((conversation) => [conversation.id, conversation]),
  );
  const legacyHarness = new ConversationHarnessStorage(
    new ConversationRepository(journal),
    (conversationId) => {
      const conversation = byId.get(conversationId);
      if (!conversation) {
        throw new Error(`Legacy conversation '${conversationId}' is missing.`);
      }
      return conversation;
    },
  );
  return promoteLiveJournalToCanonical({
    ...input,
    legacyHarness,
    runtimeIsolation: "proven",
  });
}

/** Final offline conversion, retirement, and atomic admission boundary. */
export async function promoteLiveJournalToCanonical(input: {
  store: CanonicalStore;
  paths: StoragePaths;
  legacyHarness: ConversationHarnessStorage;
  promotedAt: string;
  runtimeIsolation: "proven";
  reportProgress?: (message: string) => void;
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

async function hasConversationMigrationProof(
  proofDirectory: string,
): Promise<boolean> {
  try {
    return (await readdir(proofDirectory)).some(
      (name) => name.startsWith("conv_") && name.endsWith(".json"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
