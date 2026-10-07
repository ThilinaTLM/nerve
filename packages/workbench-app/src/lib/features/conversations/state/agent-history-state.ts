import type {
  AgentRecord,
  AgentHistoryResult,
} from "@nervekit/contracts/agents";
import type { ConversationViewState } from "./conversation-state.svelte";
import { drainedSnapshotActiveRun } from "$lib/presentation/state/conversation-snapshot";
import { stoppingAfterConversationSnapshot } from "./conversation-terminal-state";

/** History is scoped by durable context ownership, NOT the authors of cloned entries. */
export function applyAgentHistory(
  view: ConversationViewState,
  agent: Pick<AgentRecord, "id" | "conversationId">,
  history: AgentHistoryResult,
): void {
  if (
    (history.agentId && history.agentId !== agent.id) ||
    (history.conversationId &&
      history.conversationId !== agent.conversationId) ||
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
  view.entries = history.entries;
  view.activeEntryIds =
    history.activeEntryIds ?? history.entries.map((entry) => entry.id);
  view.activeEntryId =
    history.activeEntryId !== undefined
      ? (history.activeEntryId ?? undefined)
      : history.entries.at(-1)?.id;
  view.treeNodes = history.entries.map((entry) => ({
    entry,
    childEntryIds: history.entries
      .filter((child) => child.parentEntryId === entry.id)
      .map((child) => child.id),
  }));
  if (
    history.cursorSeq !== undefined ||
    history.activity !== undefined ||
    history.activeRun !== undefined
  ) {
    const previousRunId = view.activeRun?.runId;
    view.activeRun = drainedSnapshotActiveRun(
      history.activeRun,
      history.entries,
    );
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
  }
  if (history.cursorSeq !== undefined) view.cursorSeq = history.cursorSeq;
  if (history.toolCalls !== undefined) view.toolCalls = history.toolCalls;
  if (history.latestCompletion !== undefined)
    view.latestCompletion = history.latestCompletion;
  if (history.effectiveConfiguration !== undefined)
    view.effectiveConfiguration = history.effectiveConfiguration;
}
