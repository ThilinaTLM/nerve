import type { ToolCallDetails } from "@nervekit/contracts/tools";
import type {
  ToolCallRecord,
  ToolCallTranscriptRecord,
  ToolName,
} from "@nervekit/contracts/tools";
import type { WaitGroup } from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { toToolCallTranscriptRecord } from "../artifacts/tool-call-transcript-preview.js";

interface ToolCallListParams {
  status?: ToolCallRecord["status"];
  pendingInteractionKind?: "approval" | "user_input" | "plan_review";
  conversationId?: string;
  projectId?: string;
  runId?: string;
  limit?: number;
  cursor?: { updatedAt: string; id: string };
}

export interface CanonicalToolProposalProjection {
  memberId: string;
  providerToolCallId: string;
  toolName: string;
  normalizedInput: Record<string, unknown>;
  cwd: string;
  risk: ToolCallRecord["risk"];
  admission: string;
  authorizationEvidence: Record<string, unknown>;
  owner: Record<string, unknown>;
  policyObservation: { observedAt: string; selectedRuleSetId: string };
}

interface ProposalManifest {
  proposals: CanonicalToolProposalProjection[];
}

/** Rebuildable public tool views projected from canonical wait authority. */
export class CanonicalToolQueryService {
  constructor(private readonly store: CanonicalStore) {}

  async queryToolCallPreviews(params: ToolCallListParams = {}): Promise<{
    toolCalls: ToolCallTranscriptRecord[];
    nextCursor: undefined;
  }> {
    const groups = await this.store.execution.listPendingWaitGroups(
      params.limit ?? 100,
    );
    const records = (
      await Promise.all(groups.map((group) => this.records(group)))
    )
      .flat()
      .filter(
        (record) =>
          !params.conversationId ||
          record.conversationId === params.conversationId,
      )
      .filter(
        (record) => !params.projectId || record.projectId === params.projectId,
      )
      .filter((record) => !params.runId || record.runId === params.runId)
      .filter((record) => !params.status || record.status === params.status);
    return {
      toolCalls: records.map(toToolCallTranscriptRecord),
      nextCursor: undefined,
    };
  }

  async listToolCallPreviews(
    params: ToolCallListParams = {},
  ): Promise<ToolCallTranscriptRecord[]> {
    return (await this.queryToolCallPreviews(params)).toolCalls;
  }

  async getToolCallUiDetails(toolCallId: string): Promise<ToolCallDetails> {
    const group =
      await this.store.execution.findWaitGroupByMemberOwner(toolCallId);
    const record = group
      ? (await this.records(group)).find(
          (candidate) => candidate.id === toolCallId,
        )
      : undefined;
    if (!record) throw new Error("Canonical tool call not found.");
    return {
      toolCall: record,
      completeResult: {
        status: record.result === undefined ? "unavailable" : "inline",
        hasResult: record.result !== undefined,
        byteLength:
          record.result === undefined
            ? 0
            : JSON.stringify(record.result).length,
        mediaType: "application/json",
        encoding: "utf-8",
      },
    };
  }

  private async records(group: WaitGroup): Promise<ToolCallRecord[]> {
    const manifest = (await this.store.execution.readArtifactManifest(
      group.membershipManifestId.replace("wait_members", "wait_proposals"),
    )) as ProposalManifest | undefined;
    if (!manifest?.proposals) return [];
    return manifest.proposals.map((proposal) =>
      projectCanonicalToolCall(group, proposal),
    );
  }
}

export function projectCanonicalToolCall(
  group: WaitGroup,
  proposal: CanonicalToolProposalProjection,
): ToolCallRecord {
  const member = group.members.find(
    (candidate) => candidate.memberId === proposal.memberId,
  )!;
  const waiting = member.executionState === "awaiting_approval";
  const denied = member.executionState === "denied";
  const owner = proposal.owner;
  const createdAt = proposal.policyObservation.observedAt;
  return {
    id: member.ownerId,
    agentId: String(owner.agentId),
    conversationId: String(owner.conversationId),
    projectId: String(owner.projectId),
    toolName: proposal.toolName as ToolName,
    sourceToolCallId: proposal.providerToolCallId,
    providerToolCallId: proposal.providerToolCallId,
    runId: group.runId,
    risk: proposal.risk,
    args: proposal.normalizedInput,
    cwd: proposal.cwd,
    status: waiting ? "waiting" : denied ? "denied" : "committed",
    phase: waiting ? "drafted" : denied ? "denied" : "drafted",
    revision: member.revision,
    attempt: 0,
    interactions: waiting ? [pendingInteraction(proposal, createdAt)] : [],
    createdAt,
    updatedAt: createdAt,
  } as ToolCallRecord;
}

function pendingInteraction(
  proposal: CanonicalToolProposalProjection,
  createdAt: string,
): ToolCallRecord["interactions"][number] {
  const base = {
    ordinal: 0,
    status: "pending" as const,
    requestedAt: createdAt,
    updatedAt: createdAt,
  };
  if (proposal.admission === "user_input") {
    return {
      ...base,
      kind: "user_input",
      request: {
        question: String(
          proposal.normalizedInput.question ?? "Input requested",
        ),
        context:
          typeof proposal.normalizedInput.context === "string"
            ? proposal.normalizedInput.context
            : undefined,
        recommendation:
          typeof proposal.normalizedInput.recommendation === "string"
            ? proposal.normalizedInput.recommendation
            : undefined,
        required: true,
      },
    };
  }
  if (proposal.admission === "plan_review") {
    return {
      ...base,
      kind: "plan_review",
      request: {
        planPath: String(proposal.normalizedInput.planPath ?? ""),
        slug: String(proposal.normalizedInput.slug ?? "plan"),
        title:
          typeof proposal.normalizedInput.title === "string"
            ? proposal.normalizedInput.title
            : undefined,
        summary:
          typeof proposal.normalizedInput.summary === "string"
            ? proposal.normalizedInput.summary
            : undefined,
        allowNewConversation: true,
      },
    };
  }
  const permissionEvaluation =
    proposal.authorizationEvidence.permissionEvaluation;
  const suggestedRules =
    permissionEvaluation &&
    typeof permissionEvaluation === "object" &&
    "suggestedRules" in permissionEvaluation &&
    Array.isArray(permissionEvaluation.suggestedRules)
      ? permissionEvaluation.suggestedRules
      : [];
  return {
    ...base,
    kind: "approval",
    request: {
      risk: proposal.risk,
      reason:
        typeof proposal.authorizationEvidence.reason === "string"
          ? proposal.authorizationEvidence.reason
          : "Canonical policy requires approval.",
      offeredScopes:
        suggestedRules.length > 0
          ? [
              "single_call",
              "always_conversation",
              "always_project",
              "always_user",
            ]
          : ["single_call"],
      suggestedExceptions: [],
      suggestedRules,
      permissionRuleSetId: proposal.policyObservation.selectedRuleSetId,
    },
  };
}
