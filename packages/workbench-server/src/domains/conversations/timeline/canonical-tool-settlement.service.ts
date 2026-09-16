import { createHash } from "node:crypto";
import {
  childExecutionRelationshipSchema,
  type ChildExecutionRelationship,
} from "@nervekit/contracts/agents";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import { toolCallRecordSchema } from "@nervekit/contracts/tools";
import type {
  CanonicalExecutionAttempt,
  CanonicalLifecycleWork,
  ExecutionClaim,
  LogicalEffect,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalToolDispatchSnapshot } from "./canonical-tool-dispatch.service.js";
import { canonicalConversationJson } from "./command-fingerprint.js";
import { CanonicalRunTimelineService } from "./canonical-run-timeline.service.js";
import { toToolCallTranscriptRecord } from "../../tools/artifacts/tool-call-transcript-preview.js";

export type CanonicalToolSettlementResult =
  | {
      kind: "committed" | "receipt_replay";
      resultEntryId: string;
      continuationScheduled: boolean;
    }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Attaches one verified tool result and advances its barrier exactly once. */
export class CanonicalToolSettlementService {
  private readonly timeline: CanonicalRunTimelineService;

  constructor(private readonly store: CanonicalStore) {
    this.timeline = new CanonicalRunTimelineService(store);
  }

  async commitResult(input: {
    snapshot: CanonicalToolDispatchSnapshot;
    workerId: string;
    resultEntryId: string;
    result: unknown;
    exactHarnessMessage: unknown;
    failed: boolean;
    now: string;
    providerIdentity: Record<string, unknown>;
    providerCapability:
      | "stateless_generation"
      | "contractually_replay_safe"
      | "non_repeatable_or_unknown";
  }): Promise<CanonicalToolSettlementResult> {
    const snapshot = input.snapshot;
    const [head, run, effect, attempt, claim, work, group, childDocuments] =
      await Promise.all([
        this.store.readTimelineConversationHead(snapshot.conversationId),
        this.store.readTimelineRunControl(
          snapshot.conversationId,
          snapshot.runId,
        ),
        this.store.execution.readEffect(snapshot.effect.effectId),
        this.store.execution.readAttempt(snapshot.attempt.attemptId),
        this.store.execution.readClaim(snapshot.claim.claimId),
        this.store.execution.readLifecycleWork(snapshot.work.workId),
        this.store.execution.readWaitGroup(snapshot.waitGroup.waitGroupId),
        this.store.listDocuments<unknown>(
          "canonical_child_execution",
          snapshot.runId,
        ),
      ]);
    const anchorStillApplies = head?.activeEntryId
      ? await this.store.timelineEntryIsAncestor(
          snapshot.conversationId,
          snapshot.continuationEntryId,
          head.activeEntryId,
        )
      : false;
    const member = group?.members.find(
      (candidate) => candidate.memberId === snapshot.effect.memberId,
    );
    const childDocument = childDocuments.find((document) => {
      const parsed = childExecutionRelationshipSchema.safeParse(document.data);
      return (
        member?.memberKind === "child_agent" &&
        parsed.success &&
        parsed.data.parentToolCallId === member.ownerId
      );
    });
    const childRelationship = childDocument
      ? childExecutionRelationshipSchema.parse(childDocument.data)
      : undefined;
    const resultData = {
      schemaVersion: 1,
      effectId: effect?.effectId ?? snapshot.effect.effectId,
      attemptId: attempt?.attemptId ?? snapshot.attempt.attemptId,
      inputFingerprint:
        effect?.normalizedInputFingerprint ??
        snapshot.effect.normalizedInputFingerprint,
      result: input.result,
      failed: input.failed,
    };
    const publicToolCall = toolCallRecordSchema.safeParse(input.result);
    const digest = createHash("sha256")
      .update(canonicalConversationJson(resultData))
      .digest("hex");
    if (
      effect?.state === "settled" &&
      (attempt?.outcome as { digest?: string } | undefined)?.digest ===
        `sha256:${digest}` &&
      member?.attachmentDisposition === "attached" &&
      member.resultEntryId === input.resultEntryId
    ) {
      return {
        kind: "receipt_replay",
        resultEntryId: input.resultEntryId,
        continuationScheduled:
          group?.state === "ready" || group?.state === "closed",
      };
    }
    if (
      !head ||
      !run ||
      !effect ||
      !attempt ||
      !claim ||
      !work ||
      !group ||
      !member ||
      !anchorStillApplies ||
      effect.state !== "dispatching" ||
      attempt.state !== "dispatched" ||
      claim.state !== "active" ||
      claim.token !== snapshot.claim.token ||
      Date.parse(claim.leaseDeadline) <= Date.parse(input.now) ||
      work.state !== "leased" ||
      work.leaseOwner !== input.workerId ||
      Date.parse(work.leaseDeadline ?? "") <= Date.parse(input.now) ||
      member.executionState !== "executing" ||
      member.attachmentDisposition !== "pending" ||
      run.generation !== snapshot.runGeneration ||
      run.boundSelectionEpoch !== snapshot.selectionEpoch ||
      head.selectionEpoch !== snapshot.selectionEpoch ||
      head.foregroundRunId !== snapshot.runId ||
      !run.foregroundOwned
    ) {
      return rejected("tool_settlement_fence_changed");
    }
    const manifestId = `manifest_tool_result_${effect.effectId.slice("effect_".length)}`;
    const settledEffect: LogicalEffect = { ...effect, state: "settled" };
    const settledAttempt: CanonicalExecutionAttempt = {
      ...attempt,
      state: input.failed ? "known_failed" : "succeeded",
      outcome: { failed: input.failed, digest: `sha256:${digest}` },
      preparedManifestId: manifestId,
      updatedAt: input.now,
    };
    const consumedClaim: ExecutionClaim = { ...claim, state: "consumed" };
    const settledWork: CanonicalLifecycleWork = {
      ...work,
      state: "settled",
      revision: work.revision + 1,
      leaseOwner: undefined,
      leaseDeadline: undefined,
      updatedAt: input.now,
    };
    const settledMembers = group.members.map((candidate) =>
      candidate.memberId === member.memberId
        ? {
            ...candidate,
            executionState: input.failed
              ? ("known_failed" as const)
              : ("succeeded" as const),
            attachmentDisposition: "attached" as const,
            resultEntryId: input.resultEntryId,
            contributesToBarrier: true,
            revision: candidate.revision + 1,
          }
        : candidate,
    );
    const allSettled = settledMembers.every(
      (candidate) => candidate.contributesToBarrier,
    );
    const nextGroup: WaitGroup = {
      ...group,
      members: settledMembers,
      continuationConsumed: false,
      state: allSettled ? "ready" : "open",
      revision: group.revision + 1,
    };
    const continuationSuffix = `${snapshot.runId.slice("run_".length)}_${run.generation}_${run.revision + 1}`;
    const continuationManifestId = `manifest_continuation_${continuationSuffix}`;
    const continuationData = {
      schemaVersion: 1,
      conversationId: snapshot.conversationId,
      runId: snapshot.runId,
      runGeneration: run.generation,
      selectionEpoch: head.selectionEpoch,
      sourceEntryId: input.resultEntryId,
      waitGroupId: group.waitGroupId,
      providerIdentity: input.providerIdentity,
      providerCapability: input.providerCapability,
    };
    const continuationHash = `sha256:${createHash("sha256")
      .update(canonicalConversationJson(continuationData))
      .digest("hex")}`;
    const continuationWork: CanonicalLifecycleWork | undefined = allSettled
      ? {
          schemaVersion: 1,
          workId: `canonical_work_${continuationSuffix}_continuation`,
          conversationId: snapshot.conversationId,
          runId: snapshot.runId,
          kind: "prepare_continuation",
          state: "ready",
          inputHash: continuationHash,
          inputManifestId: continuationManifestId,
          generation: 0,
          revision: 1,
          notBefore: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        }
      : undefined;
    const attachmentTransitionId = `transition_tool_result_${attempt.attemptId.slice("attempt_".length)}`;
    const attachedChild: ChildExecutionRelationship | undefined =
      childRelationship?.state === "completed" &&
      childRelationship.attachmentState === "pending"
        ? childExecutionRelationshipSchema.parse({
            ...childRelationship,
            attachmentState: "attached",
            attachmentEntryId: input.resultEntryId,
            attachmentTransitionId,
            resultArtifactManifestId: manifestId,
            revision: childRelationship.revision + 1,
            updatedAt: input.now,
          })
        : undefined;
    const result = await this.timeline.append({
      conversationId: snapshot.conversationId,
      runId: snapshot.runId,
      commandId: `settle-tool-result:${attempt.attemptId}`,
      transitionId: attachmentTransitionId,
      now: input.now,
      actor: { kind: "worker", workerId: input.workerId },
      cause: {
        kind: "tool_result_settled",
        effectId: effect.effectId,
        attemptId: attempt.attemptId,
      },
      entries: [
        {
          entryId: input.resultEntryId,
          kind: attachedChild ? "child_result" : "tool_result",
          inlineContent: {
            exactHarnessMessage: input.exactHarnessMessage,
            failed: input.failed,
          },
          toolCallId: member.ownerId,
          provenance: {
            effectId: effect.effectId,
            attemptId: attempt.attemptId,
            agentId: effect.owner.agentId,
          },
        },
      ],
      artifactManifests: [
        { manifestId, schemaVersion: 1, data: resultData },
        ...(continuationWork
          ? [
              {
                manifestId: continuationManifestId,
                schemaVersion: 1,
                data: continuationData,
              },
            ]
          : []),
      ],
      waitGroups: [nextGroup],
      logicalEffects: [settledEffect],
      executionAttempts: [settledAttempt],
      executionClaims: [consumedClaim],
      lifecycleWorks: [
        settledWork,
        ...(continuationWork ? [continuationWork] : []),
      ],
      domainDocuments:
        attachedChild && childDocument
          ? [
              {
                namespace: "canonical_child_execution",
                scopeId: snapshot.runId,
                documentId: attachedChild.relationshipId,
                expectedRevision: childDocument.revision,
                payloadVersion: 1,
                data: attachedChild,
              },
            ]
          : [],
      publicationIntents: publicToolCall.success
        ? [
            {
              intentId: `evt_tool_call_updated_settled_${attempt.attemptId}`,
              stream: `conv/${snapshot.conversationId}`,
              eventType: "toolCall.updated",
              occurredAt: input.now,
              conversationId: snapshot.conversationId,
              data: {
                conversationId: snapshot.conversationId,
                agentId: publicToolCall.data.agentId,
                projectId: publicToolCall.data.projectId,
                runId: snapshot.runId,
                providerToolCallId:
                  publicToolCall.data.providerToolCallId,
                toolCall: toToolCallTranscriptRecord(publicToolCall.data),
              },
            },
          ]
        : [],
      providerPhaseId: null,
      waitGroupId: group.waitGroupId,
      runState: allSettled ? "waiting" : "partially_waiting",
    });
    return result.kind === "rejected"
      ? result
      : {
          kind: result.kind,
          resultEntryId: input.resultEntryId,
          continuationScheduled: allSettled,
        };
  }
}

function rejected(reason: string): CanonicalToolSettlementResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
