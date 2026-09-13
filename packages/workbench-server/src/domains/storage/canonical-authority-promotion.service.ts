import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TimelineAuthorityPromotion } from "@nervekit/contracts/storage";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { canonicalConversationJson } from "../conversations/timeline/command-fingerprint.js";

interface MigrationManifest {
  schemaVersion: 1;
  sourceKind: "current_home_legacy_journal";
  conversationCount: number;
  importedRunCount: number;
  importedToolRecordCount: number;
  preparedToolRecoveryCount: number;
  conversationProofDigests: Array<{
    conversationId: string;
    proofDigest: string;
  }>;
  manifestDigest: string;
}

/** Offline-only atomic admission after verified migration and process isolation. */
export class CanonicalAuthorityPromotionService {
  constructor(private readonly store: CanonicalStore) {}

  async promote(input: {
    manifestPath: string;
    oldRuntimeIsolation: "proven";
    promotedAt: string;
  }): Promise<TimelineAuthorityPromotion> {
    if (input.oldRuntimeIsolation !== "proven") {
      throw new Error("Old runtime isolation has not been proven.");
    }
    const manifest = parseManifest(
      JSON.parse(await readFile(input.manifestPath, "utf8")),
    );
    const facts = {
      schemaVersion: manifest.schemaVersion,
      sourceKind: manifest.sourceKind,
      conversationCount: manifest.conversationCount,
      importedRunCount: manifest.importedRunCount,
      importedToolRecordCount: manifest.importedToolRecordCount,
      preparedToolRecoveryCount: manifest.preparedToolRecoveryCount,
      conversationProofDigests: manifest.conversationProofDigests,
    };
    const digest = `sha256:${createHash("sha256")
      .update(canonicalConversationJson(facts))
      .digest("hex")}`;
    if (digest !== manifest.manifestDigest) {
      throw new Error("Timeline migration manifest digest is invalid.");
    }
    for (const reference of manifest.conversationProofDigests) {
      const proof = JSON.parse(
        await readFile(
          join(dirname(input.manifestPath), `${reference.conversationId}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>;
      if (
        proof.conversationId !== reference.conversationId ||
        proof.proofDigest !== reference.proofDigest
      ) {
        throw new Error("Timeline migration conversation proof is invalid.");
      }
      const proofDigest = `sha256:${createHash("sha256")
        .update(
          canonicalConversationJson(
            Object.fromEntries(
              Object.entries(proof).filter(([key]) => key !== "proofDigest"),
            ),
          ),
        )
        .digest("hex")}`;
      if (proofDigest !== reference.proofDigest) {
        throw new Error(
          "Timeline migration conversation proof digest is invalid.",
        );
      }
      const head = await this.store.readTimelineConversationHead(
        reference.conversationId,
      );
      if (!head || head.activeEntryId !== (proof.activeEntryId ?? null)) {
        throw new Error(
          "Timeline migration canonical head does not match proof.",
        );
      }
      await this.store.rebuildTimelineTranscriptProjection(
        reference.conversationId,
        input.promotedAt,
        true,
      );
    }
    await this.store.integrityCheck();
    const [identity, admission] = await Promise.all([
      this.store.readTimelineStateIdentity(),
      this.store.readTimelineRuntimeAdmission(),
    ]);
    if (
      !identity ||
      !admission ||
      admission.dispatchState !== "disabled" ||
      admission.executionIncarnationId !== identity.executionIncarnationId
    ) {
      throw new Error("Timeline migration is not fenced for promotion.");
    }
    const promotion: TimelineAuthorityPromotion = {
      schemaVersion: 1,
      promotionId: `promotion_${randomUUID()}`,
      namespaceId: identity.namespaceId,
      priorExecutionIncarnationId: identity.executionIncarnationId,
      executionIncarnationId: `incarnation_${randomUUID()}`,
      proofDigest: digest,
      oldRuntimeIsolated: true,
      state: "promoted",
      promotedAt: input.promotedAt,
    };
    return this.store.promoteTimelineRuntimeAdmission(promotion);
  }
}

function parseManifest(value: unknown): MigrationManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Timeline migration manifest is invalid.");
  }
  const record = value as Partial<MigrationManifest>;
  if (
    record.schemaVersion !== 1 ||
    record.sourceKind !== "current_home_legacy_journal" ||
    !Number.isSafeInteger(record.conversationCount) ||
    !Number.isSafeInteger(record.importedRunCount) ||
    !Number.isSafeInteger(record.importedToolRecordCount) ||
    !Number.isSafeInteger(record.preparedToolRecoveryCount) ||
    !Array.isArray(record.conversationProofDigests) ||
    typeof record.manifestDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(record.manifestDigest)
  ) {
    throw new Error("Timeline migration manifest is invalid.");
  }
  if (
    record.conversationProofDigests.length !== record.conversationCount ||
    new Set(
      record.conversationProofDigests.map((proof) => proof.conversationId),
    ).size !== record.conversationProofDigests.length
  ) {
    throw new Error("Timeline migration proof inventory is incomplete.");
  }
  for (const proof of record.conversationProofDigests) {
    if (
      !proof ||
      typeof proof.conversationId !== "string" ||
      !proof.conversationId.startsWith("conv_") ||
      !/^sha256:[a-f0-9]{64}$/.test(proof.proofDigest)
    ) {
      throw new Error("Timeline migration proof reference is invalid.");
    }
  }
  return record as MigrationManifest;
}
