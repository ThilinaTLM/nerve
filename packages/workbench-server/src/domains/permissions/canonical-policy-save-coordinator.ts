import { createHash } from "node:crypto";
import type {
  PolicySaveIntent,
  PolicyScopeReference,
} from "@nervekit/contracts/permissions";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelineIdentityService } from "../conversations/timeline/canonical-timeline-identity.service.js";
import {
  canonicalConversationJson,
  conversationCommandFingerprint,
} from "../conversations/timeline/command-fingerprint.js";
import type {
  PermissionPolicyService,
  PreparedPermissionRuleSave,
} from "./permission-policy.service.js";
import { decidePolicySaveRecovery } from "./policy-save-recovery.js";

export class CanonicalPolicySaveCoordinator {
  private readonly identity: CanonicalTimelineIdentityService;

  constructor(
    private readonly store: CanonicalStore,
    private readonly policy: PermissionPolicyService,
  ) {
    this.identity = new CanonicalTimelineIdentityService(store);
  }

  async recoverPending(input: {
    limit?: number;
    approvalStillApplicable(intent: PolicySaveIntent): Promise<boolean>;
    finalizeApproval(
      intent: PolicySaveIntent,
    ): Promise<"committed" | "superseded" | "failed">;
    now(): string;
  }): Promise<PolicySaveIntent[]> {
    const recovered: PolicySaveIntent[] = [];
    for (const intent of await this.store.policy.listPendingSaveIntents(
      input.limit ?? 128,
    )) {
      if (intent.schemaVersion !== 2) {
        recovered.push(
          await this.transition(intent, {
            state: "conflicted",
            fileOutcome: "external_conflict",
            updatedAt: input.now(),
          }),
        );
        continue;
      }
      const manifest = await this.store.execution.readArtifactManifest(
        intent.intendedDocumentManifestId,
      );
      const data = manifest as
        | {
            intendedDocumentDigest?: string;
            bytesBase64?: string;
          }
        | undefined;
      if (
        data?.intendedDocumentDigest !== intent.intendedDocumentDigest ||
        typeof data.bytesBase64 !== "string"
      ) {
        recovered.push(
          await this.transition(intent, {
            state: "conflicted",
            fileOutcome: "external_conflict",
            updatedAt: input.now(),
          }),
        );
        continue;
      }
      const prepared: PreparedPermissionRuleSave = {
        origin: intent.scope.kind,
        ...(intent.scope.kind === "user"
          ? {}
          : { ownerId: intent.scope.ownerId }),
        documentIdentity: intent.documentIdentity,
        ...(intent.observedDocumentDigest
          ? { observedDocumentDigest: intent.observedDocumentDigest }
          : {}),
        intendedDocumentDigest: intent.intendedDocumentDigest,
        intendedBytes: Buffer.from(data.bytesBase64, "base64"),
        ruleFingerprint: intent.ruleFingerprint,
      };
      const inspection = await this.policy.inspectPreparedRuleSave(prepared);
      const applicable = await input.approvalStillApplicable(intent);
      const decision = decidePolicySaveRecovery({
        intent,
        ...inspection,
        approvalStillApplicable: applicable,
      });
      if (decision.kind === "retry_file_write") {
        const writing =
          intent.state === "recorded"
            ? await this.transition(intent, {
                state: "writing",
                updatedAt: input.now(),
              })
            : intent;
        const outcome = await this.policy.commitPreparedRuleSave(prepared);
        const settled = await this.transition(writing, {
          state:
            outcome.kind === "saved"
              ? "saved_pending_finalization"
              : "conflicted",
          fileOutcome: outcome.kind === "saved" ? "saved" : "external_conflict",
          updatedAt: input.now(),
        });
        if (settled.state === "saved_pending_finalization" && applicable) {
          const approval = await input.finalizeApproval(settled);
          recovered.push(await this.finalize(settled, approval, input.now()));
        } else {
          recovered.push(settled);
        }
        continue;
      }
      if (decision.kind === "finalize_approval") {
        const beforePending =
          intent.state === "recorded"
            ? await this.transition(intent, {
                state: "writing",
                updatedAt: input.now(),
              })
            : intent;
        const pending =
          beforePending.state === "saved_pending_finalization"
            ? beforePending
            : await this.transition(beforePending, {
                state: "saved_pending_finalization",
                fileOutcome: "saved",
                updatedAt: input.now(),
              });
        const outcome = await input.finalizeApproval(pending);
        recovered.push(await this.finalize(pending, outcome, input.now()));
        continue;
      }
      if (decision.kind === "record_residual_grant") {
        const writing =
          intent.state === "recorded"
            ? await this.transition(intent, {
                state: "writing",
                updatedAt: input.now(),
              })
            : intent;
        const pending =
          writing.state === "saved_pending_finalization"
            ? writing
            : await this.transition(writing, {
                state: "saved_pending_finalization",
                fileOutcome: "saved",
                updatedAt: input.now(),
              });
        recovered.push(await this.finalize(pending, "superseded", input.now()));
        continue;
      }
      if (decision.kind === "record_conflict") {
        recovered.push(
          await this.transition(intent, {
            state: "conflicted",
            fileOutcome: "external_conflict",
            updatedAt: input.now(),
          }),
        );
      }
    }
    return recovered;
  }

  async prepareAndSave(input: {
    origin: import("@nervekit/contracts/permissions").PermissionOverlayOrigin;
    ownerId?: string;
    ruleSetId: string;
    rule: import("@nervekit/contracts/permissions").PermissionRule;
    saveIntentId: string;
    commandId: string;
    scope: PolicyScopeReference;
    conversationId: string;
    runId: string;
    memberId: string;
    approvalCommandId: string;
    now: string;
  }): Promise<PolicySaveIntent> {
    const prepared = await this.policy.prepareRuleSave(
      input.origin,
      input.ruleSetId,
      input.rule,
      input.ownerId,
    );
    return this.save({ ...input, prepared });
  }

  async finalize(
    intent: PolicySaveIntent,
    outcome: "committed" | "superseded" | "failed",
    now: string,
  ): Promise<PolicySaveIntent> {
    if (intent.state !== "saved_pending_finalization") return intent;
    const finalized: PolicySaveIntent = {
      ...intent,
      state: outcome === "committed" ? "finalized" : "finalization_superseded",
      approvalOutcome: outcome,
      updatedAt: now,
    };
    await this.commit(finalized, `${intent.commandId}:finalize`);
    return finalized;
  }

  async save(input: {
    prepared: PreparedPermissionRuleSave;
    saveIntentId: string;
    commandId: string;
    scope: PolicyScopeReference;
    conversationId: string;
    runId: string;
    memberId: string;
    approvalCommandId: string;
    now: string;
  }): Promise<PolicySaveIntent> {
    const manifestId = `manifest_${input.saveIntentId}`;
    const recorded: PolicySaveIntent = {
      schemaVersion: 2,
      saveIntentId: input.saveIntentId,
      commandId: input.commandId,
      scope: input.scope,
      documentIdentity: input.prepared.documentIdentity,
      ...(input.prepared.observedDocumentDigest
        ? {
            observedDocumentDigest: input.prepared.observedDocumentDigest,
          }
        : {}),
      intendedDocumentDigest: input.prepared.intendedDocumentDigest,
      ruleFingerprint: input.prepared.ruleFingerprint,
      conversationId: input.conversationId,
      runId: input.runId,
      memberId: input.memberId,
      approvalCommandId: input.approvalCommandId,
      intendedDocumentManifestId: manifestId,
      state: "recorded",
      fileOutcome: "not_attempted",
      approvalOutcome: "not_attempted",
      createdAt: input.now,
      updatedAt: input.now,
    };
    await this.commit(recorded, `${input.commandId}:record`, [
      {
        manifestId,
        schemaVersion: 1,
        data: {
          schemaVersion: 1,
          semanticRole: "policy_save_replacement",
          documentIdentity: input.prepared.documentIdentity,
          intendedDocumentDigest: input.prepared.intendedDocumentDigest,
          bytesBase64: Buffer.from(input.prepared.intendedBytes).toString(
            "base64",
          ),
        },
      },
    ]);
    const current = await this.store.policy.readSaveIntent(input.saveIntentId);
    if (!current) throw new Error("Policy save intent was not persisted.");
    if (current.state !== "recorded") return current;

    const writing = {
      ...current,
      state: "writing" as const,
      updatedAt: input.now,
    };
    await this.commit(writing, `${input.commandId}:writing`);
    let fileOutcome:
      | Awaited<ReturnType<PermissionPolicyService["commitPreparedRuleSave"]>>
      | undefined;
    try {
      fileOutcome = await this.policy.commitPreparedRuleSave(input.prepared);
    } catch {
      const failed = {
        ...writing,
        state: "save_failed" as const,
        fileOutcome: "failed" as const,
        updatedAt: new Date().toISOString(),
      };
      await this.commit(failed, `${input.commandId}:file-failed`);
      return failed;
    }
    const settled: PolicySaveIntent =
      fileOutcome.kind === "saved"
        ? {
            ...writing,
            state: "saved_pending_finalization",
            fileOutcome: "saved",
            updatedAt: new Date().toISOString(),
          }
        : {
            ...writing,
            state: "conflicted",
            fileOutcome: "external_conflict",
            updatedAt: new Date().toISOString(),
          };
    await this.commit(settled, `${input.commandId}:file-settled`);
    return settled;
  }

  private async transition(
    intent: PolicySaveIntent,
    patch: Partial<PolicySaveIntent>,
  ): Promise<PolicySaveIntent> {
    const next = { ...intent, ...patch } as PolicySaveIntent;
    await this.commit(next, `${intent.commandId}:recover:${next.state}`);
    return next;
  }

  private async commit(
    intent: PolicySaveIntent,
    commandId: string,
    artifactManifests: Array<{
      manifestId: string;
      schemaVersion: 1;
      data: unknown;
    }> = [],
  ): Promise<void> {
    const identity = await this.identity.resolve();
    const fingerprint = conversationCommandFingerprint({
      operation: "policy_save_intent",
      intent,
      artifactManifestDigests: artifactManifests.map((manifest) => ({
        manifestId: manifest.manifestId,
        digest: `sha256:${createHash("sha256")
          .update(canonicalConversationJson(manifest.data))
          .digest("hex")}`,
      })),
    });
    const outcome = await this.store.commitConversationCommand({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "policy_save_intent",
      ownerKind: "policy_scope",
      ownerId: `${intent.scope.kind}:${intent.scope.ownerId}`,
      commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [],
      transitions: [],
      artifactManifests,
      policySaveIntents: [intent],
      outcome: intent,
      publicationIntents: [],
      now: intent.updatedAt,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      throw new Error(`Policy save intent commit rejected: ${outcome.kind}.`);
    }
  }
}
