import type {
  AgentRecord,
  AgentHistoryResult,
} from "@nervekit/contracts/agents";
import type { ConversationViewState } from "./conversation-state.svelte";
import { drainedSnapshotActiveRun } from "$lib/presentation/state/conversation-snapshot";
import { validateAgentHistory, verifyAgentHistory } from "./history-health";
import { stoppingAfterConversationSnapshot } from "./conversation-terminal-state";

/** History is scoped by durable context ownership, NOT the authors of cloned entries. */
export function applyAgentHistory(
  view: ConversationViewState,
  agent: Pick<AgentRecord, "id" | "conversationId">,
  history: AgentHistoryResult,
): boolean {
  if (!validateAgentHistory(view, agent, history)) return false;
  view.entries = history.entries;
  view.activeEntryIds = history.activeEntryIds;
  view.activeEntryId = history.activeEntryId ?? undefined;
  view.treeNodes = history.entries.map((entry) => ({
    entry,
    navigation: { continueTarget: null, editTarget: null },
    childEntryIds: history.entries
      .filter((child) => child.parentEntryId === entry.id)
      .map((child) => child.id),
  }));
  const previousRunId = view.activeRun?.runId;
  view.activeRun = drainedSnapshotActiveRun(history.activeRun, history.entries);
  view.sending = history.activeRun
    ? ["running", "executing_tools", "retrying", "aborting"].includes(
        history.activeRun.status,
      )
    : history.activity?.state === "running";
  view.stopping = stoppingAfterConversationSnapshot(
    view.stopping,
    previousRunId,
    view.activeRun?.runId,
  );
  view.transient = undefined;
  view.retainHiddenToolCalls = true;
  view.readOnly = false;
  view.cursorSeq = history.cursorSeq;
  view.toolCalls = history.toolCalls;
  view.latestCompletion = history.latestCompletion;
  view.effectiveConfiguration = history.effectiveConfiguration;
  verifyAgentHistory(view, agent.id, history.cursorSeq);
  return true;
}
