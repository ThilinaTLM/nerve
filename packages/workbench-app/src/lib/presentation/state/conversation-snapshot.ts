import {
  type ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationLiveToolOutputSnapshot,
  ConversationSnapshot,
} from "@nervekit/contracts/conversations";
import {
  drainMaterializedActiveRunMessages,
  materializedLiveMessagesFromEntries,
} from "./active-run.js";
import type { ConversationRenderState } from "./conversation-render-state.js";

export function fromConversationSnapshot(
  snapshot: ConversationSnapshot,
): ConversationRenderState {
  return {
    conversationId: snapshot.conversation.id,
    snapshot,
    conversationRevision: snapshot.conversationRevision,
    entries: snapshot.entries,
    activeEntryIds: snapshot.activeEntryIds,
    toolCalls: snapshot.toolCalls,
    activeRun: drainedSnapshotActiveRun(snapshot.activeRun, snapshot.entries),
    queuedPrompts: snapshot.activeRun?.queuedPrompts ?? [],
    contextUsage: snapshot.contextUsage,
    cursorSeq: snapshot.cursorSeq,
    generatedAt: snapshot.generatedAt,
    sending: Boolean(
      snapshot.activeRun &&
      ["running", "retrying", "aborting"].includes(snapshot.activeRun.status),
    ),
  };
}

/**
 * Defensive snapshot normalization: a snapshot taken between entry persistence
 * and materialization marking can still carry stale prose. Draining against
 * the snapshot entries removes persisted text/thinking while retaining an
 * unresolved tool slot through the durable-record handoff.
 */
function drainedSnapshotActiveRun(
  activeRun: ConversationActiveRunSnapshot | undefined,
  entries: ConversationEntry[],
): ConversationActiveRunSnapshot | undefined {
  if (!activeRun) return undefined;
  const cloned = cloneActiveRun(activeRun) as ConversationActiveRunSnapshot;
  drainMaterializedActiveRunMessages(
    cloned,
    materializedLiveMessagesFromEntries(entries),
  );
  return cloned;
}

function cloneActiveRun(
  run: ConversationActiveRunSnapshot | undefined,
): ConversationActiveRunSnapshot | undefined {
  if (!run) return undefined;
  return {
    ...run,
    retry: run.retry ? { ...run.retry } : undefined,
    recovery: run.recovery ? { ...run.recovery } : undefined,
    queuedPrompts: [...run.queuedPrompts],
    turns: run.turns.map((turn) => ({
      ...turn,
      messages: turn.messages.map((message) => ({
        ...message,
        blocks: message.blocks.map((block) =>
          block.kind === "tool_call_draft"
            ? {
                ...block,
                args: block.args ? { ...block.args } : undefined,
                progress: block.progress ? { ...block.progress } : undefined,
              }
            : { ...block },
        ),
      })),
    })),
    toolOutputsByToolCallId: Object.fromEntries(
      Object.entries(run.toolOutputsByToolCallId).map(([id, output]) => [
        id,
        cloneLiveOutput(output),
      ]),
    ),
  };
}

function cloneLiveOutput(
  output: ConversationLiveToolOutputSnapshot,
): ConversationLiveToolOutputSnapshot {
  return {
    ...output,
    chunks: output.chunks.map((chunk) => ({ ...chunk })),
    outputLimits: output.outputLimits ? { ...output.outputLimits } : undefined,
  };
}
