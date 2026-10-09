import type {
  AgentHistoryResult,
  AgentRecord,
} from "@nervekit/contracts/agents";
import type { ConversationViewState } from "./conversation-state.svelte";
import {
  failHistoryRefresh,
  validateAgentHistory,
  verifyAgentHistory,
} from "./history-health";

/** A failed response belongs to the requested owner, not capability enrichment
 * or an untrusted response's claimed owner. Success still requires both proofs. */
export function applyRequestedHistoryRefresh(
  view: ConversationViewState,
  agent: Pick<AgentRecord, "id" | "conversationId">,
  token: number,
  cursorSeq: number,
  result: PromiseSettledResult<AgentHistoryResult | undefined>,
  capabilityAgentId: string | null,
): boolean {
  if (
    view.historyRefreshId !== token ||
    view.historyHealth?.agentId !== agent.id
  )
    return false;
  if (result.status === "rejected") {
    failHistoryRefresh(view, agent.id, token, cursorSeq, result.reason);
    return false;
  }
  try {
    if (!result.value)
      throw new Error("Requested agent history is unavailable");
    if (!validateAgentHistory(view, agent, result.value)) return false;
    if (capabilityAgentId !== agent.id)
      throw new Error("Conversation model navigation owner is unavailable");
    return verifyAgentHistory(view, agent.id, result.value.cursorSeq, token);
  } catch (error) {
    failHistoryRefresh(view, agent.id, token, cursorSeq, error);
    return false;
  }
}
