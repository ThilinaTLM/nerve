import type { AgentRecord } from "@nervekit/contracts/agents";
import { ApplicationError } from "../../core/application-error.js";

export interface CompactionOwner {
  conversationId: string;
  ownerAgentId?: string;
  key: string;
}

export function compactionOwnerKey(
  conversationId: string,
  ownerAgentId?: string,
): string {
  return JSON.stringify([conversationId, ownerAgentId ?? "lead"]);
}

/** Persisted context binding owns storage; parent fallback is only for undecoded fixtures. */
export function resolveCompactionOwner(
  conversationId: string,
  agent?: AgentRecord,
): CompactionOwner {
  if (agent && agent.conversationId !== conversationId) {
    throw new ApplicationError(
      400,
      "INVALID_COMPACTION_OWNER",
      "Agent does not belong to this conversation.",
    );
  }
  const ownerAgentId =
    agent?.contextOwnerAgentId !== undefined
      ? (agent.contextOwnerAgentId ?? undefined)
      : agent?.parentAgentId
        ? agent.id
        : undefined;
  return {
    conversationId,
    ownerAgentId,
    key: compactionOwnerKey(conversationId, ownerAgentId),
  };
}

export interface CompactionCommitGuard {
  ownerAgentId?: string;
  expectedModelLeafId: string | null;
  expectedActiveEntryId?: string | null;
}

export class CompactionStaleConflictError extends ApplicationError {
  constructor(conversationId: string) {
    super(
      409,
      "STALE_COMPACTION",
      `Conversation '${conversationId}' compaction source changed; context was not changed.`,
    );
    this.name = "CompactionStaleConflictError";
  }
}
