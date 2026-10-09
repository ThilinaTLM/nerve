import type {
  AgentRecord,
  AgentHistoryResult,
} from "@nervekit/contracts/agents";
import type { ConversationViewState } from "./conversation-state.svelte";

export function historyExecutionError(
  view: ConversationViewState,
  agentId: string | undefined,
): string | undefined {
  if (!agentId) return undefined;
  const health = view.historyHealth;
  if (view.navigation && view.navigation.contextState !== "valid")
    return (
      view.navigation.problem?.message ??
      (health?.agentId === agentId ? health.error : undefined) ??
      "Model history is unavailable. Choose a verified history target before continuing."
    );
  if (health?.agentId !== agentId || health.state !== "verified")
    return health?.agentId === agentId && health.error
      ? health.error
      : "Agent history has not been verified. Refresh history before continuing.";
  return undefined;
}

export function beginHistoryRefresh(
  view: ConversationViewState,
  agentId: string,
): number {
  const token = (view.historyRefreshId ?? 0) + 1;
  view.historyRefreshId = token;
  if (view.historyHealth?.agentId !== agentId)
    view.historyHealth = {
      agentId,
      state: "pending",
      cursorSeq: view.cursorSeq ?? 0,
    };
  return token;
}

export function failHistoryRefresh(
  view: ConversationViewState,
  agentId: string,
  token: number,
  cursorSeq: number,
  error: unknown,
): void {
  if (
    view.historyRefreshId !== token ||
    view.historyHealth?.agentId !== agentId ||
    (view.cursorSeq ?? 0) > cursorSeq
  )
    return;
  view.historyHealth = {
    agentId,
    state: "error",
    cursorSeq,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function validateAgentHistory(
  view: ConversationViewState,
  agent: Pick<AgentRecord, "id" | "conversationId">,
  history: AgentHistoryResult,
): boolean {
  if (
    (view.conversationId && view.conversationId !== agent.conversationId) ||
    history.agentId !== agent.id ||
    history.conversationId !== agent.conversationId ||
    (history.latestCompletion &&
      history.latestCompletion.agentId !== agent.id) ||
    (history.effectiveConfiguration &&
      history.effectiveConfiguration.agentId !== agent.id) ||
    (history.activeRun &&
      (history.activeRun.agentId !== agent.id ||
        history.activeRun.conversationId !== agent.conversationId)) ||
    (history.activity &&
      (history.activity.agentId !== agent.id ||
        history.activity.conversationId !== agent.conversationId)) ||
    (history.activeRun &&
      history.activity &&
      history.activity.activeRunId !== history.activeRun.runId)
  )
    throw new Error("Agent history ownership mismatch");
  if (view.historyHealth && view.historyHealth.agentId !== agent.id)
    return false;
  return (
    history.cursorSeq >= (view.cursorSeq ?? 0) &&
    history.cursorSeq >= (view.historyHealth?.cursorSeq ?? 0)
  );
}

export function verifyAgentHistory(
  view: ConversationViewState,
  agentId: string,
  cursorSeq: number,
  token?: number,
): boolean {
  if (
    (token !== undefined && view.historyRefreshId !== token) ||
    (view.historyHealth && view.historyHealth.agentId !== agentId)
  )
    return false;
  view.historyHealth = { agentId, state: "verified", cursorSeq };
  return true;
}

/** Observe every rejection immediately, independently of canonical display success. */
export async function settleConversationRefresh<S, Q, H>(
  snapshot: Promise<S>,
  queue: Promise<Q>,
  history: Promise<H>,
) {
  const [snapshotResult, queueResult, historyResult] = await Promise.allSettled(
    [snapshot, queue, history],
  );
  return {
    snapshot: snapshotResult,
    queue: queueResult,
    history: historyResult,
  };
}
