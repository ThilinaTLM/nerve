import type { QueuedPromptRecord } from "@nervekit/contracts/agents";
import { type ConversationActiveRunSnapshot } from "@nervekit/contracts/conversations";
import type {
  ConversationRenderState,
  ConversationRunOutcome,
} from "./conversation-render-state.js";

export function ensureActiveRun(
  state: ConversationRenderState,
  data: {
    conversationId: string;
    agentId: string;
    projectId: string;
    runId: string;
    startedAt?: string;
  },
): ConversationActiveRunSnapshot {
  if (state.activeRun?.runId === data.runId) return state.activeRun;
  state.activeRun = {
    runId: data.runId,
    agentId: data.agentId,
    projectId: data.projectId,
    conversationId: data.conversationId,
    status: "running",
    startedAt: data.startedAt ?? new Date().toISOString(),
    turns: [],
    toolOutputsByToolCallId: {},
    // The legacy live snapshot contains only genuine legacy prompt records.
    // Canonical input identity stays in state.queuedPrompts, never remapped.
    queuedPrompts: (state.queuedPrompts ?? []).filter(
      (item): item is QueuedPromptRecord => !("state" in item),
    ),
  };
  return state.activeRun;
}

/**
 * Record the terminal outcome of the current active run. Call before clearing
 * `activeRun`; events for a different (stale) run leave the outcome untouched.
 */
export function recordRunOutcome(
  state: Pick<ConversationRenderState, "activeRun" | "lastRunOutcome">,
  runId: string | undefined,
  outcome: ConversationRunOutcome["outcome"],
  endedAt: string,
): void {
  const activeRun = state.activeRun;
  if (!activeRun || !runMatches(activeRun.runId, runId)) return;
  state.lastRunOutcome = {
    runId: activeRun.runId,
    outcome,
    startedAt: activeRun.startedAt,
    endedAt,
  };
}

export function runMatches(
  currentRunId: string | undefined,
  runId: string | undefined,
): boolean {
  return Boolean(currentRunId && runId && currentRunId === runId);
}
