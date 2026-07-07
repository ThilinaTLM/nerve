import type {
  ConversationEntryAppendedData,
  ConversationEventType,
  ConversationLiveContentDeltaData,
  ConversationLiveContentDoneData,
  ConversationLiveMessageStartedData,
  ConversationLiveToolDraftDeltaData,
  ConversationLiveToolDraftDoneData,
  ConversationLiveToolDraftStartedData,
  ConversationLiveToolOutputDeltaData,
  ConversationSnapshot,
  ConversationToolCallUpdatedData,
  EventEnvelope,
  SandboxConversationViewSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/shared";
import {
  type ConversationRenderState,
  emptyConversationRenderState,
} from "./types.js";

export function fromConversationSnapshot(
  snapshot: ConversationSnapshot,
): ConversationRenderState {
  return {
    conversationId: snapshot.conversation.id,
    snapshot,
    entries: snapshot.entries,
    activeEntryIds: snapshot.activeEntryIds,
    toolCalls: snapshot.toolCalls,
    activeRun: snapshot.activeRun,
    contextUsage: snapshot.contextUsage,
    cursorSeq: snapshot.cursorSeq,
    generatedAt: snapshot.generatedAt,
  };
}

export function fromSandboxConversationViewSnapshot(
  view: SandboxConversationViewSnapshot,
): ConversationRenderState {
  if (view.snapshot) {
    return {
      ...fromConversationSnapshot(view.snapshot),
      stale: view.stale,
      readOnly: view.fallback?.readOnly,
      fallbackReason: view.fallback?.reason,
    };
  }
  return {
    ...emptyConversationRenderState(view.conversationId),
    stale: view.stale,
    readOnly: view.fallback?.readOnly ?? true,
    fallbackReason: view.fallback?.reason,
    generatedAt: view.generatedAt,
    cursorSeq: view.lastEventSeq ?? 0,
  };
}

export function applyConversationEvent(
  state: ConversationRenderState,
  event: EventEnvelope,
): ConversationRenderState {
  if (!event.type.startsWith("conversation.")) return state;
  const next: ConversationRenderState = {
    ...state,
    entries: [...state.entries],
    activeEntryIds: [...state.activeEntryIds],
    toolCalls: [...state.toolCalls],
    activeRun: state.activeRun
      ? {
          ...state.activeRun,
          turns: state.activeRun.turns.map((turn) => ({
            ...turn,
            messages: turn.messages.map((message) => ({
              ...message,
              blocks: message.blocks.map((block) => ({ ...block })),
            })),
          })),
          toolOutputsByToolCallId: {
            ...state.activeRun.toolOutputsByToolCallId,
          },
        }
      : undefined,
    cursorSeq:
      event.durability === "durable"
        ? Math.max(state.cursorSeq, event.seq)
        : state.cursorSeq,
  };
  const type = event.type as ConversationEventType;
  switch (type) {
    case "conversation.run.started": {
      const data = event.data as {
        conversationId: string;
        agentId: string;
        runId: string;
        projectId: string;
        startedAt: string;
      };
      next.conversationId = data.conversationId;
      next.activeRun = {
        runId: data.runId,
        agentId: data.agentId,
        projectId: data.projectId,
        conversationId: data.conversationId,
        status: "running",
        startedAt: data.startedAt,
        turns: [],
        toolOutputsByToolCallId: {},
        queuedPrompts: [],
      };
      break;
    }
    case "conversation.run.completed":
    case "conversation.run.failed":
      next.activeRun = undefined;
      break;
    case "conversation.entry.appended": {
      const data = event.data as ConversationEntryAppendedData;
      next.entries = upsert(next.entries, data.entry.id, data.entry);
      next.activeEntryIds = [data.entry.id];
      break;
    }
    case "conversation.tool_call.updated": {
      const data = event.data as ConversationToolCallUpdatedData;
      next.toolCalls = upsertToolCallUpdate(next.toolCalls, data.toolCall);
      break;
    }
    case "conversation.context.updated":
      next.contextUsage = (
        event.data as { contextUsage: typeof next.contextUsage }
      ).contextUsage;
      break;
    case "conversation.live.message.started":
      applyLiveMessageStarted(
        next,
        event.data as ConversationLiveMessageStartedData,
      );
      break;
    case "conversation.live.content.delta":
      applyLiveContentDelta(
        next,
        event.data as ConversationLiveContentDeltaData,
      );
      break;
    case "conversation.live.content.done":
      applyLiveContentDone(next, event.data as ConversationLiveContentDoneData);
      break;
    case "conversation.live.tool_draft.started":
      applyToolDraftStarted(
        next,
        event.data as ConversationLiveToolDraftStartedData,
      );
      break;
    case "conversation.live.tool_draft.delta":
      applyToolDraftDelta(
        next,
        event.data as ConversationLiveToolDraftDeltaData,
      );
      break;
    case "conversation.live.tool_draft.done":
      applyToolDraftDone(next, event.data as ConversationLiveToolDraftDoneData);
      break;
    case "conversation.live.tool_output.delta":
      applyToolOutputDelta(
        next,
        event.data as ConversationLiveToolOutputDeltaData,
      );
      break;
  }
  return next;
}

function applyLiveMessageStarted(
  state: ConversationRenderState,
  data: ConversationLiveMessageStartedData,
): void {
  if (!state.activeRun) return;
  let turn = state.activeRun.turns.find((item) => item.turnId === data.turnId);
  if (!turn) {
    turn = {
      turnId: data.turnId,
      ordinal: state.activeRun.turns.length,
      messages: [],
    };
    state.activeRun.turns.push(turn);
  }
  if (
    !turn.messages.some(
      (message) => message.liveMessageId === data.liveMessageId,
    )
  ) {
    turn.messages.push({
      liveMessageId: data.liveMessageId,
      messageOrdinal: data.messageOrdinal,
      startedAt: data.startedAt,
      blocks: [],
    });
  }
}

function applyLiveContentDelta(
  state: ConversationRenderState,
  data: ConversationLiveContentDeltaData,
): void {
  const message = liveMessage(state, data.turnId, data.liveMessageId);
  if (!message) return;
  let block = message.blocks.find(
    (item) => item.contentBlockId === data.contentBlockId,
  );
  if (!block || block.kind === "tool_call_draft") {
    block = {
      kind: data.kind,
      contentBlockId: data.contentBlockId,
      contentIndex: data.contentIndex,
      text: "",
      done: false,
    };
    message.blocks.push(block);
  }
  block.text = `${block.text.slice(0, data.offset)}${data.delta}`;
}

function applyLiveContentDone(
  state: ConversationRenderState,
  data: ConversationLiveContentDoneData,
): void {
  const message = liveMessage(state, data.turnId, data.liveMessageId);
  const block = message?.blocks.find(
    (item) => item.contentBlockId === data.contentBlockId,
  );
  if (!block || block.kind === "tool_call_draft") return;
  if (data.finalText !== undefined) block.text = data.finalText;
  block.done = true;
  block.redacted = data.redacted;
}

function applyToolDraftStarted(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftStartedData,
): void {
  const message = liveMessage(state, data.turnId, data.liveMessageId);
  if (!message) return;
  message.blocks.push({
    kind: "tool_call_draft",
    contentBlockId: data.contentBlockId,
    contentIndex: data.contentIndex,
    argsText: "",
    done: false,
    providerToolCallId: data.providerToolCallId,
    toolName: data.toolName,
  });
}

function applyToolDraftDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDeltaData,
): void {
  const block = liveMessage(
    state,
    data.turnId,
    data.liveMessageId,
  )?.blocks.find((item) => item.contentBlockId === data.contentBlockId);
  if (block?.kind !== "tool_call_draft") return;
  block.argsText = `${block.argsText.slice(0, data.offset)}${data.delta}`;
}

function applyToolDraftDone(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDoneData,
): void {
  const block = liveMessage(
    state,
    data.turnId,
    data.liveMessageId,
  )?.blocks.find((item) => item.contentBlockId === data.contentBlockId);
  if (block?.kind !== "tool_call_draft") return;
  block.done = true;
  block.args = data.args;
  block.providerToolCallId = data.providerToolCallId;
  block.toolName = data.toolName;
}

function applyToolOutputDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolOutputDeltaData,
): void {
  if (!state.activeRun) return;
  const existing = state.activeRun.toolOutputsByToolCallId[data.toolCallId];
  state.activeRun.toolOutputsByToolCallId[data.toolCallId] = {
    toolCallId: data.toolCallId,
    chunks: [
      ...(existing?.chunks ?? []),
      { stream: data.stream, text: data.delta, ts: new Date().toISOString() },
    ],
    text: `${existing?.text ?? ""}${data.delta}`,
    updatedAt: new Date().toISOString(),
  };
}

function liveMessage(
  state: ConversationRenderState,
  turnId: string,
  liveMessageId: string,
) {
  return state.activeRun?.turns
    .find((turn) => turn.turnId === turnId)
    ?.messages.find((message) => message.liveMessageId === liveMessageId);
}

function upsertToolCallUpdate(
  items: ToolCallTranscriptRecord[],
  update: ToolCallTranscriptRecord,
): ToolCallTranscriptRecord[] {
  const existing = items.find((candidate) => candidate.id === update.id);
  const merged: ToolCallTranscriptRecord = existing
    ? {
        ...existing,
        ...update,
        argsPreview:
          update.argsPreview === undefined
            ? existing.argsPreview
            : update.argsPreview,
        resultPreview:
          update.resultPreview === undefined
            ? existing.resultPreview
            : update.resultPreview,
        previewOverflow:
          update.previewOverflow === undefined
            ? existing.previewOverflow
            : update.previewOverflow,
      }
    : update;
  return upsert(items, update.id, merged);
}

function upsert<T extends { id: string }>(
  items: T[],
  id: string,
  item: T,
): T[] {
  const index = items.findIndex((candidate) => candidate.id === id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}
