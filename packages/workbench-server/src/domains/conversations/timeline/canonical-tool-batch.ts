import { createHash } from "node:crypto";
import type { PolicyDocumentObservation } from "@nervekit/contracts/permissions";
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

export interface CanonicalToolProposalInput {
  providerToolCallId: string;
  toolName: string;
  normalizedInputFingerprint: string;
  normalizedInput: Record<string, unknown>;
  cwd: string;
  risk: ToolCallRecord["risk"];
  capability: ToolReplayCapability;
  policyObservation: PolicyDocumentObservation;
  authorizationEvidence: Record<string, unknown>;
  owner: Record<string, unknown>;
  externalScope?: Record<string, unknown>;
  externalKey?: string;
}

export interface CanonicalToolBatchAuthority {
  waitGroup: WaitGroup;
  policyObservations: PolicyDocumentObservation[];
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
        memberKind: "tool" as const,
        ownerId: proposal.providerToolCallId,
        inputFingerprint: proposal.normalizedInputFingerprint,
        policyFingerprint: proposal.policyObservation.completeDocumentDigest,
        executionState: "authorized" as const,
        attachmentDisposition: "pending" as const,
        contributesToBarrier: false,
        revision: 1,
      },
    };
  });
  const waitGroup: WaitGroup = {
    schemaVersion: 1,
    waitGroupId,
    runId: input.runId,
    membershipManifestId,
    continuationEntryId: input.continuationEntryId,
    continuationConsumed: false,
    state: "open",
    revision: 1,
    members: members.map(({ member }) => member),
  };
  const authorizations: ExactCallAuthorization[] = members.map(
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
  const effects: LogicalEffect[] = members.map(
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
  const inputManifests = effects.map((effect, index) => ({
    manifestId: `manifest_tool_input_${effect.effectId.slice("effect_".length)}`,
    schemaVersion: 1 as const,
    data: {
      schemaVersion: 1,
      effectId: effect.effectId,
      toolName: effect.toolName,
      providerToolCallId: input.proposals[index]!.providerToolCallId,
      normalizedInputFingerprint: effect.normalizedInputFingerprint,
      normalizedInput: input.proposals[index]!.normalizedInput,
      cwd: input.proposals[index]!.cwd,
      risk: input.proposals[index]!.risk,
      policyObservation: input.proposals[index]!.policyObservation,
      providerIdentity: input.providerIdentity,
      providerCapability: input.providerCapability,
    },
  }));
  const work: CanonicalLifecycleWork[] = effects.map((effect, index) => ({
    schemaVersion: 1,
    workId: `canonical_work_${effect.effectId.slice("effect_".length)}_claim`,
    conversationId: input.conversationId,
    runId: input.runId,
    kind: "claim_tool_attempt",
    effectId: effect.effectId,
    state: "ready",
    inputHash: effect.normalizedInputFingerprint,
    inputManifestId: inputManifests[index]!.manifestId,
    generation: 0,
    revision: 1,
    notBefore: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  }));
  return {
    waitGroup,
    policyObservations: input.proposals.map(
      (proposal) => proposal.policyObservation,
    ),
    authorizations,
    effects,
    work,
    inputManifests,
  };
}
