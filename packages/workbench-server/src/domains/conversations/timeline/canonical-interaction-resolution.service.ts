import { createHash } from "node:crypto";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import type {
  CanonicalLifecycleWork,
  ExactCallAuthorization,
  LogicalEffect,
  RunControl,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type { ToolName } from "@nervekit/contracts/tools";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { ToolService } from "../../tools/execution/tool-service.js";
import { canonicalConversationJson } from "./command-fingerprint.js";
import { CanonicalRunTimelineService } from "./canonical-run-timeline.service.js";

interface MembershipProposal {
  memberId: string;
  suffix: string;
  admission?: string;
  providerToolCallId: string;
  toolName: ToolName;
  normalizedInputFingerprint: string;
  normalizedInput: Record<string, unknown>;
  cwd: string;
  risk: string;
  capability: LogicalEffect["capability"];
  policyObservation: import("@nervekit/contracts/permissions").PolicyDocumentObservation;
  authorizationEvidence: Record<string, unknown>;
  owner: Record<string, unknown>;
  externalScope?: Record<string, unknown>;
  externalKey?: string;
}

interface MembershipManifest {
  schemaVersion: 1;
  waitGroupId: string;
  providerIdentity: Record<string, unknown>;
  providerCapability:
    | "stateless_generation"
    | "contractually_replay_safe"
    | "non_repeatable_or_unknown";
  proposals: MembershipProposal[];
}

export type CanonicalInteractionResolutionResult =
  | { kind: "committed" | "receipt_replay"; memberId: string }
  | { kind: "rejected"; outcome: MutationOutcome };

/** Resolves one pending tool interaction without consulting legacy tool records. */
export class CanonicalInteractionResolutionService {
  private readonly timeline: CanonicalRunTimelineService;

  constructor(
    private readonly store: CanonicalStore,
    private readonly tools: ToolService,
    private readonly getAgentForConversation: (
      conversationId: string,
    ) => AgentRecord | undefined,
  ) {
    this.timeline = new CanonicalRunTimelineService(store);
  }

  async resolve(input: {
    providerToolCallId: string;
    decision:
      | "allow_once"
      | "deny"
      | "answer"
      | "dismiss"
      | "accept"
      | "request_changes"
      | "reject"
      | "discard";
    responseText?: string;
    settleWork?: CanonicalLifecycleWork;
    commandId: string;
    now: string;
  }): Promise<CanonicalInteractionResolutionResult> {
    const group = await this.store.execution.findWaitGroupByMemberOwner(
      input.providerToolCallId,
    );
    const member = group?.members.find(
      (candidate) => candidate.ownerId === input.providerToolCallId,
    );
    if (!group || !member) return rejected("interaction_not_pending");
    const manifest = parseManifest(
      await this.store.execution.readArtifactManifest(
        group.membershipManifestId.replace("wait_members", "wait_proposals"),
      ),
    );
    const proposal = manifest?.proposals.find(
      (candidate) => candidate.memberId === member.memberId,
    );
    const conversationId = proposal?.owner.conversationId;
    if (!manifest || !proposal || typeof conversationId !== "string") {
      return rejected("interaction_evidence_missing");
    }
    const internalSettlement =
      proposal.admission === "internal_command" &&
      member.executionState === "authorized" &&
      input.settleWork?.kind === "execute_internal_command";
    if (member.executionState !== "awaiting_approval" && !internalSettlement) {
      return rejected("interaction_not_pending");
    }
    const run = await this.store.readTimelineRunControl(
      conversationId,
      group.runId,
    );
    if (!run || run.waitGroupId !== group.waitGroupId || !run.foregroundOwned) {
      return rejected("interaction_run_fenced");
    }
    const head = await this.store.readTimelineConversationHead(
      run.conversationId,
    );
    if (
      !head ||
      head.foregroundRunId !== run.runId ||
      head.selectionEpoch !== run.boundSelectionEpoch
    ) {
      return rejected("interaction_selection_fenced");
    }
    const responseDecision = !["allow_once", "deny"].includes(input.decision);
    const responseEntryId = `entry_interaction_${proposal.suffix}`;
    const nextMembers = group.members.map((candidate) =>
      candidate.memberId !== member.memberId
        ? candidate
        : input.decision === "deny"
          ? {
              ...candidate,
              executionState: "denied" as const,
              attachmentDisposition: "not_executed" as const,
              nonDispatchEvidenceId: `evidence_${proposal.suffix}_denied`,
              contributesToBarrier: true,
              revision: candidate.revision + 1,
            }
          : responseDecision
            ? {
                ...candidate,
                executionState: "succeeded" as const,
                attachmentDisposition: "attached" as const,
                resultEntryId: responseEntryId,
                contributesToBarrier: true,
                revision: candidate.revision + 1,
              }
            : {
                ...candidate,
                executionState: "authorized" as const,
                revision: candidate.revision + 1,
              },
    );
    const allSettled = nextMembers.every(
      (candidate) => candidate.contributesToBarrier,
    );
    const nextGroup: WaitGroup = {
      ...group,
      members: nextMembers,
      state: allSettled ? "ready" : "open",
      revision: group.revision + 1,
    };
    const authorizations: ExactCallAuthorization[] = [];
    const effects: LogicalEffect[] = [];
    const work: CanonicalLifecycleWork[] = [];
    const artifactManifests: Array<{
      manifestId: string;
      schemaVersion: 1;
      data: unknown;
    }> = [];

    if (input.decision === "allow_once") {
      const agent = this.getAgentForConversation(run.conversationId);
      if (!agent) return rejected("interaction_agent_missing");
      const current = await this.tools.prepareCanonicalToolProposal(
        agent,
        proposal.toolName,
        proposal.normalizedInput,
        proposal.providerToolCallId,
      );
      if (
        current.normalizedInputFingerprint !==
          proposal.normalizedInputFingerprint ||
        current.admission === "denied" ||
        current.admission === "internal_command"
      ) {
        return rejected("interaction_policy_changed");
      }
      const authorizationId = `authorization_${proposal.suffix}`;
      const effectId = `effect_${proposal.suffix}`;
      authorizations.push({
        schemaVersion: 1,
        authorizationId,
        memberId: member.memberId,
        normalizedInputFingerprint: proposal.normalizedInputFingerprint,
        policyObservationId: current.policyObservation.observationId,
        runGeneration: run.generation,
        selectionEpoch: head.selectionEpoch,
        state: "active",
        evidence: {
          ...proposal.authorizationEvidence,
          exactApprovalCommandId: input.commandId,
        },
        createdAt: input.now,
      });
      effects.push({
        schemaVersion: 1,
        effectId,
        memberId: member.memberId,
        toolName: proposal.toolName,
        capability: proposal.capability,
        normalizedInputFingerprint: proposal.normalizedInputFingerprint,
        owner: proposal.owner,
        ...(proposal.externalScope
          ? { externalScope: proposal.externalScope }
          : {}),
        ...(proposal.externalKey ? { externalKey: proposal.externalKey } : {}),
        authorizationId,
        state: "authorized",
        createdAt: input.now,
      });
      const inputManifestId = `manifest_tool_input_${proposal.suffix}`;
      artifactManifests.push({
        manifestId: inputManifestId,
        schemaVersion: 1,
        data: {
          schemaVersion: 1,
          effectId,
          toolName: proposal.toolName,
          providerToolCallId: proposal.providerToolCallId,
          normalizedInputFingerprint: proposal.normalizedInputFingerprint,
          normalizedInput: proposal.normalizedInput,
          cwd: proposal.cwd,
          risk: proposal.risk,
          policyObservation: current.policyObservation,
          providerIdentity: manifest.providerIdentity,
          providerCapability: manifest.providerCapability,
          exactApproval: true,
        },
      });
      work.push({
        schemaVersion: 1,
        workId: `canonical_work_${proposal.suffix}_claim`,
        conversationId: run.conversationId,
        runId: run.runId,
        kind: "claim_tool_attempt",
        effectId,
        state: "ready",
        inputHash: proposal.normalizedInputFingerprint,
        inputManifestId,
        generation: 0,
        revision: 1,
        notBefore: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      });
    } else if (allSettled) {
      const continuation = buildContinuation(
        run,
        head.selectionEpoch,
        group,
        manifest,
        input.now,
        responseDecision ? responseEntryId : run.continuationEntryId,
      );
      artifactManifests.push(continuation.manifest);
      work.push(continuation.work);
    }

    const result = await this.timeline.append({
      conversationId: run.conversationId,
      runId: run.runId,
      commandId: input.commandId,
      now: input.now,
      actor: { kind: "user" },
      cause: { kind: "interaction_resolved", decision: input.decision },
      entries: responseDecision
        ? [
            {
              entryId: responseEntryId,
              kind: "tool_result",
              inlineContent: {
                exactHarnessMessage: {
                  role: "toolResult",
                  toolCallId: proposal.providerToolCallId,
                  toolName: proposal.toolName,
                  content: [
                    {
                      type: "text",
                      text:
                        input.responseText ??
                        `Interaction resolved: ${input.decision}`,
                    },
                  ],
                  isError: false,
                  timestamp: Date.parse(input.now),
                },
              },
              toolCallId: member.ownerId,
              runId: run.runId,
              provenance: { interactionCommandId: input.commandId },
            },
          ]
        : [],
      artifactManifests,
      waitGroups: [nextGroup],
      policyObservations:
        input.decision === "allow_once"
          ? [
              (
                artifactManifests[0]!.data as {
                  policyObservation: MembershipProposal["policyObservation"];
                }
              ).policyObservation,
            ]
          : [],
      authorizations,
      logicalEffects: effects,
      lifecycleWorks: [
        ...work,
        ...(input.settleWork
          ? [
              {
                ...input.settleWork,
                state: "settled" as const,
                revision: input.settleWork.revision + 1,
                leaseOwner: undefined,
                leaseDeadline: undefined,
                updatedAt: input.now,
              },
            ]
          : []),
      ],
      runState: allSettled ? "waiting" : "partially_waiting",
    });
    return result.kind === "rejected"
      ? result
      : { kind: result.kind, memberId: member.memberId };
  }
}

function buildContinuation(
  run: RunControl,
  selectionEpoch: number,
  group: WaitGroup,
  manifest: MembershipManifest,
  now: string,
  sourceEntryId: string | null,
) {
  const suffix = `${run.runId.slice(4)}_${run.generation}_${run.revision + 1}`;
  const manifestId = `manifest_continuation_${suffix}`;
  const data = {
    schemaVersion: 1,
    conversationId: run.conversationId,
    runId: run.runId,
    runGeneration: run.generation,
    selectionEpoch,
    sourceEntryId,
    waitGroupId: group.waitGroupId,
    providerIdentity: manifest.providerIdentity,
    providerCapability: manifest.providerCapability,
  };
  return {
    manifest: { manifestId, schemaVersion: 1 as const, data },
    work: {
      schemaVersion: 1 as const,
      workId: `canonical_work_${suffix}_continuation`,
      conversationId: run.conversationId,
      runId: run.runId,
      kind: "prepare_continuation" as const,
      state: "ready" as const,
      inputHash: `sha256:${createHash("sha256").update(canonicalConversationJson(data)).digest("hex")}`,
      inputManifestId: manifestId,
      generation: 0,
      revision: 1,
      notBefore: now,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function parseManifest(value: unknown): MembershipManifest | undefined {
  const manifest = value as Partial<MembershipManifest> | undefined;
  return manifest?.schemaVersion === 1 &&
    typeof manifest.waitGroupId === "string" &&
    Array.isArray(manifest.proposals)
    ? (manifest as MembershipManifest)
    : undefined;
}

function rejected(reason: string): CanonicalInteractionResolutionResult {
  return { kind: "rejected", outcome: { kind: "superseded", reason } };
}
