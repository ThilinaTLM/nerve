import { type ConversationActiveRunSnapshot } from "@nervekit/contracts/conversations";
import type { ConversationRenderState } from "./conversation-render-state.js";

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
    queuedPrompts: state.queuedPrompts ?? [],
  };
  return state.activeRun;
}

export function runMatches(
  currentRunId: string | undefined,
  runId: string | undefined,
): boolean {
  return Boolean(currentRunId && runId && currentRunId === runId);
}
