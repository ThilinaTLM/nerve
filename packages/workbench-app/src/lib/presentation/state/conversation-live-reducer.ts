import {
  type ConversationActiveRunSnapshot,
  ConversationLiveContentDeltaData,
  ConversationLiveContentDoneData,
  ConversationLiveMessageStartedData,
  ConversationLiveTurnStartedData,
  ConversationLiveToolDraftDeltaData,
  ConversationLiveToolDraftDiscardedData,
  ConversationLiveToolDraftDoneData,
  ConversationLiveToolDraftProgressData,
  ConversationLiveToolDraftStartedData,
  ConversationLiveToolOutputDeltaData,
  ConversationLiveToolOutputSnapshot,
  LIVE_TOOL_OUTPUT_MAX_CHARS,
  LIVE_TOOL_OUTPUT_MAX_CHUNKS,
} from "@nervekit/contracts/conversations";
import type { ConversationRenderState } from "./conversation-render-state.js";
import { ConversationCowDraft } from "./conversation-cow-draft.js";
import {
  type ApplyConversationEventOptions,
  reportGap,
} from "./conversation-event-policy.js";
import { ensureActiveRun } from "./conversation-run-state.js";

export function applyLiveTurnStarted(
  state: ConversationRenderState,
  data: ConversationLiveTurnStartedData,
  ts: string,
): void {
  const run = ensureActiveRun(state, { ...data, startedAt: ts });
  ensureActiveTurn(run, data.turnId, data.ordinal);
  run.status = "running";
  run.retry = undefined;
  state.sending = true;
}

export function applyLiveMessageStarted(
  state: ConversationRenderState,
  data: ConversationLiveMessageStartedData,
): void {
  ensureActiveMessage(state, data, data.startedAt);
  // Streaming resumed; a pending retry attempt has evidently succeeded.
  if (state.activeRun && state.activeRun.status === "retrying") {
    state.activeRun.status = "running";
    state.activeRun.retry = undefined;
  }
  state.sending = true;
}

export function applyLiveContentDelta(
  state: ConversationRenderState,
  data: ConversationLiveContentDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
  draft: ConversationCowDraft,
): void {
  if (!data.delta) return;
  const current = findActiveBlock(state, data);
  const currentLength =
    current && current.kind !== "tool_call_draft" ? current.text.length : 0;
  if (currentLength > data.offset) return;
  if (currentLength < data.offset) {
    reportGap(options, data, "conversation.live.content.delta");
    return;
  }
  draft.ownBlock(data.turnId, data.liveMessageId, data.contentBlockId);
  const block = ensureActiveTextBlock(state, data, ts);
  if (block) block.text = `${block.text}${data.delta}`;
  state.sending = true;
}

export function applyLiveContentDone(
  state: ConversationRenderState,
  data: ConversationLiveContentDoneData,
  ts: string,
  draft: ConversationCowDraft,
): void {
  draft.ownBlock(data.turnId, data.liveMessageId, data.contentBlockId);
  const block = ensureActiveTextBlock(state, data, ts);
  if (!block) return;
  block.done = true;
  block.redacted = data.kind === "thinking" ? data.redacted : undefined;
}

export function applyToolDraftStarted(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftStartedData,
  ts: string,
  draft: ConversationCowDraft,
): void {
  draft.ownBlock(data.turnId, data.liveMessageId, data.contentBlockId);
  ensureActiveToolDraftBlock(state, data, ts);
  state.sending = true;
}

export function applyToolDraftDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
  draft: ConversationCowDraft,
): void {
  const current = findActiveBlock(state, data);
  const currentLength =
    current?.kind === "tool_call_draft" ? current.argsText.length : 0;
  if (currentLength > data.offset) return;
  if (currentLength < data.offset) {
    reportGap(options, data, "conversation.live.tool_draft.delta");
    return;
  }
  draft.ownBlock(data.turnId, data.liveMessageId, data.contentBlockId);
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (block) block.argsText = `${block.argsText}${data.delta}`;
}

export function applyToolDraftDone(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDoneData,
  ts: string,
  draft: ConversationCowDraft,
): void {
  draft.ownBlock(data.turnId, data.liveMessageId, data.contentBlockId);
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (!block) return;
  block.argsText = "";
  block.args = data.args;
  block.done = true;
  block.providerToolCallId = data.providerToolCallId;
  block.toolName = data.toolName;
}

export function applyToolDraftProgress(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftProgressData,
  ts: string,
  draft: ConversationCowDraft,
): void {
  draft.ownBlock(data.turnId, data.liveMessageId, data.contentBlockId);
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (!block || block.done || data.revision <= block.progressRevision) return;
  block.progress = data.progress;
  block.progressRevision = data.revision;
}

export function applyToolDraftDiscarded(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDiscardedData,
): void {
  const message = activeMessage(state, data.turnId, data.liveMessageId);
  if (!message) return;
  message.blocks = message.blocks.filter((block) => {
    if (block.kind !== "tool_call_draft") return true;
    if (block.contentIndex === data.contentIndex) return false;
    if (
      data.providerToolCallId &&
      block.providerToolCallId === data.providerToolCallId
    )
      return false;
    return true;
  });
}

export function applyToolOutputDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolOutputDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
  draft: ConversationCowDraft,
): void {
  if (!data.delta) return;
  const activeRun =
    state.activeRun ??
    (data.runId
      ? ensureActiveRun(state, {
          conversationId: data.conversationId,
          agentId: data.agentId,
          projectId: data.projectId,
          runId: data.runId,
          startedAt: ts,
        })
      : undefined);
  if (!activeRun) return;
  const previous = activeRun.toolOutputsByToolCallId[data.toolCallId];
  const previousTotal =
    previous?.outputLimits?.totalChars ?? previous?.text.length ?? 0;
  if (previousTotal > data.offset) return;
  if (previousTotal < data.offset) {
    reportGap(options, data, "conversation.live.tool_output.delta");
    return;
  }
  draft.ownOutputMap();
  const writableRun = state.activeRun;
  if (!writableRun) return;
  writableRun.toolOutputsByToolCallId = {
    ...writableRun.toolOutputsByToolCallId,
    [data.toolCallId]: capLiveOutput({
      toolCallId: data.toolCallId,
      chunks: [
        ...(previous?.chunks ?? []),
        { stream: data.stream, text: data.delta, ts },
      ],
      text: `${previous?.text ?? ""}${data.delta}`,
      updatedAt: ts,
      outputLimits: {
        capped: false,
        direction: "tail",
        maxChars: LIVE_TOOL_OUTPUT_MAX_CHARS,
        maxChunks: LIVE_TOOL_OUTPUT_MAX_CHUNKS,
        totalChars: previousTotal + data.delta.length,
      },
    }),
  };
}

function ensureActiveTurn(
  run: ConversationActiveRunSnapshot,
  turnId: string,
  ordinal = run.turns.length,
) {
  let turn = run.turns.find((item) => item.turnId === turnId);
  if (!turn) {
    turn = { turnId, ordinal, messages: [] };
    run.turns.push(turn);
  }
  return turn;
}

function ensureActiveMessage(
  state: ConversationRenderState,
  data: {
    conversationId: string;
    agentId: string;
    projectId: string;
    runId: string;
    turnId: string;
    liveMessageId: string;
    messageOrdinal?: number;
  },
  startedAt: string,
) {
  const run = ensureActiveRun(state, { ...data, startedAt });
  const turn = ensureActiveTurn(run, data.turnId);
  let message = turn.messages.find(
    (item) => item.liveMessageId === data.liveMessageId,
  );
  if (!message) {
    message = {
      liveMessageId: data.liveMessageId,
      messageOrdinal: data.messageOrdinal ?? turn.messages.length,
      startedAt,
      blocks: [],
    };
    turn.messages.push(message);
  }
  return message;
}

function findActiveBlock(
  state: ConversationRenderState,
  data: { turnId: string; liveMessageId: string; contentBlockId: string },
) {
  return activeMessage(state, data.turnId, data.liveMessageId)?.blocks.find(
    (block) => block.contentBlockId === data.contentBlockId,
  );
}

function ensureActiveTextBlock(
  state: ConversationRenderState,
  data: ConversationLiveContentDeltaData | ConversationLiveContentDoneData,
  ts: string,
) {
  const message = ensureActiveMessage(
    state,
    data,
    activeMessageStartedAt(state, data) ?? ts,
  );
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
  return block;
}

function ensureActiveToolDraftBlock(
  state: ConversationRenderState,
  data:
    | ConversationLiveToolDraftStartedData
    | ConversationLiveToolDraftDeltaData
    | ConversationLiveToolDraftDoneData
    | ConversationLiveToolDraftProgressData,
  ts: string,
) {
  const message = ensureActiveMessage(
    state,
    data,
    activeMessageStartedAt(state, data) ?? ts,
  );
  let block = message.blocks.find(
    (item) => item.contentBlockId === data.contentBlockId,
  );
  if (block?.kind !== "tool_call_draft") {
    block = {
      kind: "tool_call_draft",
      contentBlockId: data.contentBlockId,
      contentIndex: data.contentIndex,
      argsText: "",
      progressRevision: 0,
      done: false,
    };
    message.blocks.push(block);
  }
  block.providerToolCallId =
    data.providerToolCallId ?? block.providerToolCallId;
  block.toolName = data.toolName ?? block.toolName;
  return block;
}

function activeMessage(
  state: ConversationRenderState,
  turnId: string,
  liveMessageId: string,
) {
  return state.activeRun?.turns
    .find((turn) => turn.turnId === turnId)
    ?.messages.find((message) => message.liveMessageId === liveMessageId);
}

function activeMessageStartedAt(
  state: ConversationRenderState,
  data: { turnId: string; liveMessageId: string },
): string | undefined {
  return activeMessage(state, data.turnId, data.liveMessageId)?.startedAt;
}

export function capLiveOutput(
  output: ConversationLiveToolOutputSnapshot,
): ConversationLiveToolOutputSnapshot {
  const totalChars = output.outputLimits?.totalChars ?? output.text.length;
  let text = output.text;
  if (text.length > LIVE_TOOL_OUTPUT_MAX_CHARS) {
    text = text.slice(text.length - LIVE_TOOL_OUTPUT_MAX_CHARS);
  }
  const chunks =
    output.chunks.length > LIVE_TOOL_OUTPUT_MAX_CHUNKS
      ? output.chunks.slice(output.chunks.length - LIVE_TOOL_OUTPUT_MAX_CHUNKS)
      : output.chunks;
  const capped =
    totalChars > text.length ||
    output.chunks.length > LIVE_TOOL_OUTPUT_MAX_CHUNKS;
  return {
    ...output,
    text,
    chunks,
    outputLimits: {
      capped,
      direction: "tail",
      maxChars: LIVE_TOOL_OUTPUT_MAX_CHARS,
      maxChunks: LIVE_TOOL_OUTPUT_MAX_CHUNKS,
      totalChars,
      displayedChars: text.length,
      omittedChars: Math.max(0, totalChars - text.length),
      displayedLines: countLines(text),
      totalLines: capped ? undefined : countLines(text),
      omittedLines: undefined,
    },
  };
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}
