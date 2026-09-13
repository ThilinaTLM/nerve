import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalStore } from "../../persistence/canonical-sqlite/canonical-store.js";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";
import {
  LegacyConversationTimelineImporter,
  type LegacyConversationImportProof,
} from "./import-legacy-conversation.js";
import { readPost0012ConversationTimeline } from "./read-post0012-conversation.js";

/** Converts all supported source conversations and publishes deterministic proof reports. */
export async function migratePost0012ConversationTimelines(input: {
  sourceHome: string;
  targetStore: CanonicalStore;
  proofDirectory: string;
  importedAt: string;
}): Promise<LegacyConversationImportProof[]> {
  const sourceRoot = join(input.sourceHome, "conversations");
  const directories = await readdir(sourceRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const conversationIds = directories
    .filter(
      (entry) =>
        entry.isDirectory() && /^conv_[A-Za-z0-9_-]+$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  await mkdir(input.proofDirectory, { recursive: true, mode: 0o700 });
  const importer = new LegacyConversationTimelineImporter(input.targetStore);
  const proofs: LegacyConversationImportProof[] = [];
  for (const conversationId of conversationIds) {
    const source = await readPost0012ConversationTimeline({
      sourceHome: input.sourceHome,
      conversationId,
      importedAt: input.importedAt,
    });
    const { proof } = await importer.import(source);
    await atomicWriteJson(
      join(input.proofDirectory, `${conversationId}.json`),
      proof,
      0o600,
    );
    proofs.push(proof);
  }
  return proofs;
}
