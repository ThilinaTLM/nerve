import { createHash } from "node:crypto";
import type {
  PolicyDiagnostic,
  PolicyDocumentObservation,
} from "@nervekit/contracts/permissions";
import type {
  CanonicalLifecycleWork,
  ExactCallAuthorization,
  LogicalEffect,
  WaitGroup,
} from "@nervekit/contracts/runs";
import type {
  ToolCallRecord,
  ToolReplayCapability,
} from "@nervekit/contracts/tools";
import type { AppendEntryDraft } from "./transition-builders.js";
import { projectCanonicalToolCall } from "../../tools/execution/canonical-tool-query.service.js";
import { toToolCallTranscriptRecord } from "../../tools/artifacts/tool-call-transcript-preview.js";

export interface CanonicalToolProposalInput {
  admission:
    | "authorized"
    | "awaiting_approval"
    | "policy_blocked"
    | "user_input"
    | "plan_review"
    | "denied"
    | "internal_command";
  providerToolCallId: string;
  toolName: string;
  normalizedInputFingerprint: string;
  normalizedInput: Record<string, unknown>;
  cwd: string;
  risk: ToolCallRecord["risk"];
  capability: ToolReplayCapability;
  policyObservation: PolicyDocumentObservation;
  authorizationEvidence: Record<string, unknown>;
  policyFailure?: Omit<
    PolicyDiagnostic,
    | "schemaVersion"
    | "diagnosticId"
    | "affectedMemberIds"
    | "state"
    | "observedAt"
  >;
  owner: Record<string, unknown>;
  externalScope?: Record<string, unknown>;
  externalKey?: string;
}

export interface CanonicalToolBatchAuthority {
  waitGroup: WaitGroup;
  entries: AppendEntryDraft[];
  toolCalls: import("@nervekit/contracts/tools").ToolCallTranscriptRecord[];
  policyObservations: PolicyDocumentObservation[];
  policyDiagnostics: PolicyDiagnostic[];
  authorizations: ExactCallAuthorization[];
  effects: LogicalEffect[];
  work: CanonicalLifecycleWork[];
  inputManifests: Array<{
    manifestId: string;
    schemaVersion: 1;
    data: unknown;
  }>;
}

/** Builds immutable, pre-dispatch authority for one committed provider batch. */
export function buildCanonicalToolBatch(input: {
  conversationId: string;
  runId: string;
  runGeneration: number;
  selectionEpoch: number;
  continuationEntryId: string;
  phaseId: string;
  providerIdentity: Record<string, unknown>;
  providerCapability:
    | "stateless_generation"
    | "contractually_replay_safe"
    | "non_repeatable_or_unknown";
  proposals: readonly CanonicalToolProposalInput[];
  now: string;
}): CanonicalToolBatchAuthority | undefined {
  if (input.proposals.length === 0) return undefined;
  if (input.proposals.length > 32) {
    throw new RangeError("Canonical tool batch exceeds 32 members.");
  }
  const phaseSuffix = input.phaseId.slice("provider_phase_".length);
  const waitGroupId = `wait_group_${phaseSuffix}`;
  const membershipManifestId = `manifest_wait_members_${phaseSuffix}`;
  const proposalManifestId = `manifest_wait_proposals_${phaseSuffix}`;
  const seenCalls = new Set<string>();
  const members = input.proposals.map((proposal, index) => {
    if (seenCalls.has(proposal.providerToolCallId)) {
      throw new Error("Canonical tool-call identity is duplicated.");
    }
    seenCalls.add(proposal.providerToolCallId);
    if (!/^sha256:[a-f0-9]{64}$/.test(proposal.normalizedInputFingerprint)) {
      throw new Error("Canonical tool input fingerprint is invalid.");
    }
    const suffix = createHash("sha256")
      .update(`${input.phaseId}:${proposal.providerToolCallId}:${index}`)
      .digest("hex")
      .slice(0, 32);
    return {
      proposal,
      suffix,
      member: {
        schemaVersion: 1 as const,
        memberId: `member_${suffix}`,
        waitGroupId,
        memberKind:
          proposal.toolName === "explore"
            ? ("child_agent" as const)
            : ("tool" as const),
        ownerId: `tool_${suffix}`,
        inputFingerprint: proposal.normalizedInputFingerprint,
        policyFingerprint: proposal.policyObservation.completeDocumentDigest,
        executionState:
          proposal.admission === "authorized" ||
          proposal.admission === "internal_command"
            ? ("authorized" as const)
            : proposal.admission === "denied"
              ? ("denied" as const)
              : ("awaiting_approval" as const),
        attachmentDisposition:
          proposal.admission === "denied"
            ? ("not_executed" as const)
            : ("pending" as const),
        ...(proposal.admission === "denied"
          ? { nonDispatchEvidenceId: `evidence_${suffix}` }
          : {}),
        contributesToBarrier: proposal.admission === "denied",
        revision: 1,
      },
    };
  });
  const deniedEntries: AppendEntryDraft[] = members.flatMap(
    ({ proposal, member, suffix }) =>
      proposal.admission === "denied"
        ? [
            {
              entryId: `entry_tool_denied_${suffix}`,
              kind: "tool_result" as const,
              inlineContent: {
                exactHarnessMessage: {
                  role: "toolResult",
                  toolCallId: proposal.providerToolCallId,
                  toolName: proposal.toolName,
                  content: [{ type: "text", text: "Tool call denied." }],
                  isError: true,
                  timestamp: Date.parse(input.now),
                },
                failed: true,
              },
              runId: input.runId,
              toolCallId: member.ownerId,
              provenance: {
                nonDispatchEvidenceId: member.nonDispatchEvidenceId!,
              },
            },
          ]
        : [],
  );
  const continuationEntryId =
    deniedEntries.at(-1)?.entryId ?? input.continuationEntryId;
  const waitGroup: WaitGroup = {
    schemaVersion: 1,
    waitGroupId,
    runId: input.runId,
    membershipManifestId,
    continuationEntryId,
    continuationConsumed: false,
    state: members.every(({ member }) => member.contributesToBarrier)
      ? "ready"
      : "open",
    revision: 1,
    members: members.map(({ member }) => member),
  };
  const authorized = members.filter(
    ({ proposal }) =>
      proposal.admission === "authorized" ||
      proposal.admission === "internal_command",
  );
  const authorizations: ExactCallAuthorization[] = authorized.map(
    ({ proposal, member, suffix }) => ({
      schemaVersion: 1,
      authorizationId: `authorization_${suffix}`,
      memberId: member.memberId,
      normalizedInputFingerprint: proposal.normalizedInputFingerprint,
      policyObservationId: proposal.policyObservation.observationId,
      runGeneration: input.runGeneration,
      selectionEpoch: input.selectionEpoch,
      state: "active",
      evidence: proposal.authorizationEvidence,
      createdAt: input.now,
    }),
  );
  const effects: LogicalEffect[] = authorized.map(
    ({ proposal, member, suffix }, index) => ({
      schemaVersion: 1,
      effectId: `effect_${suffix}`,
      memberId: member.memberId,
      toolName: proposal.toolName,
      capability: proposal.capability,
      normalizedInputFingerprint: proposal.normalizedInputFingerprint,
      owner: proposal.owner,
      ...(proposal.externalScope
        ? { externalScope: proposal.externalScope }
        : {}),
      ...(proposal.externalKey ? { externalKey: proposal.externalKey } : {}),
      authorizationId: authorizations[index]!.authorizationId,
      state: "authorized",
      createdAt: input.now,
    }),
  );
  const inputManifests: CanonicalToolBatchAuthority["inputManifests"] = [
    {
      manifestId: proposalManifestId,
      schemaVersion: 1 as const,
      data: {
        schemaVersion: 1,
        waitGroupId,
        providerIdentity: input.providerIdentity,
        providerCapability: input.providerCapability,
        proposals: members.map(({ proposal, member, suffix }) => ({
          memberId: member.memberId,
          suffix,
          ...proposal,
        })),
      },
    },
    ...effects.map((effect, index) => ({
      manifestId: `manifest_tool_input_${effect.effectId.slice("effect_".length)}`,
      schemaVersion: 1 as const,
      data: {
        schemaVersion: 1,
        effectId: effect.effectId,
        toolName: effect.toolName,
        providerToolCallId: authorized[index]!.proposal.providerToolCallId,
        normalizedInputFingerprint: effect.normalizedInputFingerprint,
        normalizedInput: authorized[index]!.proposal.normalizedInput,
        cwd: authorized[index]!.proposal.cwd,
        risk: authorized[index]!.proposal.risk,
        policyObservation: authorized[index]!.proposal.policyObservation,
        providerIdentity: input.providerIdentity,
        providerCapability: input.providerCapability,
      },
    })),
  ];
  const work: CanonicalLifecycleWork[] = [
    ...effects.map((effect) => ({
      schemaVersion: 1 as const,
      workId: `canonical_work_${effect.effectId.slice("effect_".length)}_claim`,
      conversationId: input.conversationId,
      runId: input.runId,
      kind: "claim_tool_attempt" as const,
      effectId: effect.effectId,
      state: "ready" as const,
      inputHash: effect.normalizedInputFingerprint,
      inputManifestId: `manifest_tool_input_${effect.effectId.slice("effect_".length)}`,
      generation: 0,
      revision: 1,
      notBefore: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  ];
  if (waitGroup.state === "ready") {
    const continuationManifestId = `manifest_continuation_${phaseSuffix}_initial`;
    const continuationData = {
      schemaVersion: 1,
      conversationId: input.conversationId,
      runId: input.runId,
      runGeneration: input.runGeneration,
      selectionEpoch: input.selectionEpoch,
      sourceEntryId: continuationEntryId,
      waitGroupId,
      providerIdentity: input.providerIdentity,
      providerCapability: input.providerCapability,
    };
    const inputHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(continuationData))
      .digest("hex")}`;
    inputManifests.push({
      manifestId: continuationManifestId,
      schemaVersion: 1,
      data: continuationData,
    });
    work.push({
      schemaVersion: 1,
      workId: `canonical_work_${phaseSuffix}_continuation`,
      conversationId: input.conversationId,
      runId: input.runId,
      kind: "prepare_continuation",
      state: "ready",
      inputHash,
      inputManifestId: continuationManifestId,
      generation: 0,
      revision: 1,
      notBefore: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
  return {
    waitGroup,
    entries: deniedEntries,
    toolCalls: members.map(({ proposal, member, suffix }) =>
      toToolCallTranscriptRecord(
        projectCanonicalToolCall(waitGroup, {
          memberId: member.memberId,
          suffix,
          ...proposal,
        }),
      ),
    ),
    policyObservations: input.proposals.map(
      (proposal) => proposal.policyObservation,
    ),
    policyDiagnostics: members.flatMap(({ proposal, member, suffix }) =>
      proposal.policyFailure
        ? [
            {
              schemaVersion: 1 as const,
              diagnosticId: `policy_diagnostic_${suffix}`,
              ...proposal.policyFailure,
              affectedMemberIds: [member.memberId],
              state: "unresolved" as const,
              observedAt: input.now,
            },
          ]
        : [],
    ),
    authorizations,
    effects,
    work,
    inputManifests,
  };
}
