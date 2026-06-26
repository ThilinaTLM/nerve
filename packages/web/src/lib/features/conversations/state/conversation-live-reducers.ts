import { toolCallTranscriptRecordSchema } from "@nervekit/shared";
import type {
  ConversationEntry,
  EventEnvelope,
  ToolCallTranscriptRecord,
} from "$lib/api";
import type {
  ConversationViewState,
  TranscriptItem,
} from "$lib/core/types/state-types";
import {
  liveTextFromLegacyLive,
  refreshConversationView,
} from "$lib/features/conversations/state/conversation-flow.svelte";
import { entryToTranscriptItems } from "$lib/features/conversations/state/transcript";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import {
  active,
  capLiveOutput,
  draftKey,
  ensureLiveState,
  entryBelongsToActiveBranch,
  liveRunStatusId,
  liveTextId,
  MAX_LIVE_TOOL_OUTPUT_CHARS,
  MAX_LIVE_TOOL_OUTPUT_CHUNKS,
  numberValue,
  removeLiveRunStatusTranscriptItem,
  stringValue,
  toolDraftProgressFromValue,
  updateActiveBranchPath,
  updateConversationActiveEntryId,
  updateTreeNodesForEntry,
} from "./conversation-reducer-shared";
import { removeDiscardedToolDraft } from "./tool-draft-reducer-helpers";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function inlineCommandPromptTexts(entry: ConversationEntry): Set<string> {
  const details = recordValue(entry.details);
  if (details?.type !== "inline_command_result") return new Set();
  const command =
    typeof details.command === "string" ? details.command.trim() : "";
  if (!command) return new Set();
  return new Set([`!${command}`, `! ${command}`]);
}

function toolCallFromEntry(
  entry: ConversationEntry,
): ToolCallTranscriptRecord | undefined {
  const details = recordValue(entry.details);
  const nestedDetails = recordValue(details?.details);
  for (const candidate of [details?.toolCall, nestedDetails?.toolCall]) {
    const parsed = toolCallTranscriptRecordSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

export function handleEntryAppended(
  view: ConversationViewState,
  entry: ConversationEntry | undefined,
): boolean {
  if (!entry) return true;
  if (!entryBelongsToActiveBranch(view, entry)) return false;

  updateActiveBranchPath(view, entry);
  updateTreeNodesForEntry(view, entry);
  updateConversationActiveEntryId(view.conversationId, entry.id);
  if (active(view.conversationId)) selection.entryId = entry.id;

  if (entry.kind === "run_status") {
    removeLiveRunStatusTranscriptItem(view, entry.runId);
  }
  const items = entryToTranscriptItems(entry);
  const ids = new Set(items.map((item) => item.id).filter(Boolean));
  const inlineCommandPrompts = inlineCommandPromptTexts(entry);
  view.transcript = [
    ...view.transcript.filter((item) => !item.id || !ids.has(item.id)),
    ...items,
  ].filter((item, _index, all) => {
    if (!item.optimistic) return true;
    if (entry.role === "user" && item.role === "user") return false;
    if (item.role === "user" && inlineCommandPrompts.has(item.text.trim())) {
      return false;
    }
    return !all.some(
      (candidate) =>
        !candidate.optimistic &&
        candidate.role === item.role &&
        candidate.text === item.text,
    );
  });
  handleToolCallUpdated(view, toolCallFromEntry(entry));
  if (entry.role === "assistant" && entry.liveMessageId) {
    const livePrefix = `live:${entry.liveMessageId}:`;
    view.live.messages = view.live.messages.filter(
      (item) => !item.id?.startsWith(livePrefix),
    );
    view.live.toolDrafts = view.live.toolDrafts.filter(
      (draft) => !draft.key.startsWith(livePrefix),
    );
    view.streamingText = liveTextFromLegacyLive(view.live);
  }
  return true;
}

export function handleToolCallUpdated(
  view: ConversationViewState,
  toolCall: ToolCallTranscriptRecord | undefined,
): void {
  if (!toolCall) return;
  if (toolCall.hidden) {
    view.toolCalls = view.toolCalls.filter(
      (candidate) => candidate.id !== toolCall.id,
    );
    return;
  }
  const index = view.toolCalls.findIndex(
    (candidate) => candidate.id === toolCall.id,
  );
  view.toolCalls =
    index === -1
      ? [...view.toolCalls, toolCall]
      : view.toolCalls.map((candidate) =>
          candidate.id === toolCall.id ? toolCall : candidate,
        );
  const providerToolCallId =
    toolCall.providerToolCallId ?? toolCall.sourceToolCallId;
  if (providerToolCallId) {
    view.live.toolDrafts = view.live.toolDrafts.filter(
      (draft) => draft.providerToolCallId !== providerToolCallId,
    );
  }
}

function upsertLiveMessage(
  view: ConversationViewState,
  item: TranscriptItem,
): void {
  const index = view.live.messages.findIndex(
    (candidate) => candidate.id === item.id,
  );
  view.live.messages =
    index === -1
      ? [...view.live.messages, item]
      : view.live.messages.map((candidate) =>
          candidate.id === item.id ? item : candidate,
        );
}

export function handleContentDelta(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const delta = typeof event.data?.delta === "string" ? event.data.delta : "";
  if (!delta) return;
  const runId =
    typeof event.data?.runId === "string" ? event.data.runId : undefined;
  ensureLiveState(view, runId);
  const id = liveTextId(event.data);
  const current = view.live.messages.find((item) => item.id === id);
  const expected = Number(event.data?.offset ?? current?.text.length ?? 0);
  if (current && current.text.length > expected) return;
  if (current && current.text.length < expected) {
    void refreshConversationView(view.conversationId);
    return;
  }
  const kind = event.data?.kind === "thinking" ? "thinking" : "text";
  upsertLiveMessage(view, {
    id,
    role: "assistant",
    displayKind: kind === "thinking" ? "thinking" : "message",
    text: `${current?.text ?? ""}${delta}`,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    contentIndex: Number(event.data?.contentIndex ?? 0),
    live: true,
    done: false,
    redacted: current?.redacted,
  });
  view.streamingText = liveTextFromLegacyLive(view.live);
  view.sending = true;
}

export function handleContentDone(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const runId =
    typeof event.data?.runId === "string" ? event.data.runId : undefined;
  ensureLiveState(view, runId);
  const id = liveTextId(event.data);
  const current = view.live.messages.find((item) => item.id === id);
  const kind = event.data?.kind === "thinking" ? "thinking" : "text";
  upsertLiveMessage(view, {
    id,
    role: "assistant",
    displayKind: kind === "thinking" ? "thinking" : "message",
    text:
      typeof event.data?.finalText === "string"
        ? event.data.finalText
        : (current?.text ?? ""),
    createdAt: current?.createdAt ?? new Date().toISOString(),
    contentIndex: Number(event.data?.contentIndex ?? 0),
    live: false,
    done: true,
    redacted: kind === "thinking" ? Boolean(event.data?.redacted) : undefined,
  });
  view.streamingText = liveTextFromLegacyLive(view.live);
}

function upsertToolDraft(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
  patch: Record<string, unknown>,
) {
  const key = draftKey(event.data);
  const current = view.live.toolDrafts.find((draft) => draft.key === key);
  const updated = {
    kind: "tool_call_draft" as const,
    key,
    runId:
      typeof event.data?.runId === "string" ? event.data.runId : current?.runId,
    conversationId: view.conversationId,
    contentIndex: Number(
      event.data?.contentIndex ?? current?.contentIndex ?? 0,
    ),
    providerToolCallId:
      typeof event.data?.providerToolCallId === "string"
        ? event.data.providerToolCallId
        : current?.providerToolCallId,
    toolName:
      typeof event.data?.toolName === "string"
        ? event.data.toolName
        : current?.toolName,
    argsText:
      typeof patch.argsText === "string"
        ? patch.argsText
        : (current?.argsText ?? ""),
    args: (patch.args as Record<string, unknown> | undefined) ?? current?.args,
    progress: toolDraftProgressFromValue(patch.progress) ?? current?.progress,
    done: typeof patch.done === "boolean" ? patch.done : current?.done,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  view.live.toolDrafts = current
    ? view.live.toolDrafts.map((draft) => (draft.key === key ? updated : draft))
    : [...view.live.toolDrafts, updated];
}

export function handleToolDraftStarted(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  ensureLiveState(
    view,
    typeof event.data?.runId === "string" ? event.data.runId : undefined,
  );
  upsertToolDraft(view, event, {});
}

export function handleToolDraftDelta(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  ensureLiveState(
    view,
    typeof event.data?.runId === "string" ? event.data.runId : undefined,
  );
  const key = draftKey(event.data);
  const current = view.live.toolDrafts.find((draft) => draft.key === key);
  const delta = typeof event.data?.delta === "string" ? event.data.delta : "";
  const expected = Number(event.data?.offset ?? current?.argsText.length ?? 0);
  if (current && current.argsText.length > expected) return;
  if (current && current.argsText.length < expected) {
    void refreshConversationView(view.conversationId);
    return;
  }
  upsertToolDraft(view, event, {
    argsText: `${current?.argsText ?? ""}${delta}`,
  });
}

export function handleToolDraftDone(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  ensureLiveState(
    view,
    typeof event.data?.runId === "string" ? event.data.runId : undefined,
  );
  upsertToolDraft(view, event, {
    args:
      event.data?.args && typeof event.data.args === "object"
        ? event.data.args
        : undefined,
    done: true,
  });
}

export function handleToolDraftDiscarded(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  ensureLiveState(
    view,
    typeof event.data?.runId === "string" ? event.data.runId : undefined,
  );
  const key = draftKey(event.data);
  const providerToolCallId =
    typeof event.data?.providerToolCallId === "string"
      ? event.data.providerToolCallId
      : undefined;
  view.live.toolDrafts = removeDiscardedToolDraft(
    view.live.toolDrafts,
    key,
    providerToolCallId,
  );
}

export function handleToolDraftProgress(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  ensureLiveState(
    view,
    typeof event.data?.runId === "string" ? event.data.runId : undefined,
  );
  const progress = toolDraftProgressFromValue(event.data?.progress);
  if (!progress) return;
  upsertToolDraft(view, event, { progress });
}

export function handleToolOutputDelta(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const toolCallId = event.data?.toolCallId;
  const delta = event.data?.delta;
  const stream = event.data?.stream;
  if (
    typeof toolCallId !== "string" ||
    typeof delta !== "string" ||
    delta.length === 0 ||
    (stream !== "stdout" && stream !== "stderr" && stream !== "combined")
  )
    return;
  ensureLiveState(
    view,
    typeof event.data?.runId === "string" ? event.data.runId : undefined,
  );
  const previous = view.live.toolOutputByToolCallId[toolCallId];
  const expected = Number(event.data?.offset ?? previous?.text.length ?? 0);
  if (previous && previous.text.length > expected) return;
  if (previous && previous.text.length < expected) {
    void refreshConversationView(view.conversationId);
    return;
  }
  const updatedAt = new Date().toISOString();
  const output = capLiveOutput({
    chunks: [
      ...(previous?.chunks ?? []),
      { stream, text: delta, ts: updatedAt },
    ],
    text: `${previous?.text ?? ""}${delta}`,
    updatedAt,
    outputLimits: {
      capped: false,
      direction: "tail",
      maxChars: MAX_LIVE_TOOL_OUTPUT_CHARS,
      maxChunks: MAX_LIVE_TOOL_OUTPUT_CHUNKS,
      totalChars:
        (previous?.outputLimits?.totalChars ?? previous?.text.length ?? 0) +
        delta.length,
    },
  });
  view.live.toolOutputByToolCallId = {
    ...view.live.toolOutputByToolCallId,
    [toolCallId]: output,
  };
}

export function handleRunRetrying(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const runId = String(event.data?.runId ?? "");
  const live = ensureLiveState(view, runId);
  const retry = {
    attempt: numberValue(event.data?.attempt) ?? 0,
    maxRetries: numberValue(event.data?.maxRetries) ?? 0,
    delayMs: numberValue(event.data?.delayMs) ?? 0,
    retryAt: stringValue(event.data?.retryAt) ?? new Date().toISOString(),
    errorMessage: stringValue(event.data?.errorMessage),
    failedEntryId: stringValue(event.data?.failedEntryId),
  };
  const notice = {
    conversationId: stringValue(event.data?.conversationId),
    agentId: stringValue(event.data?.agentId),
    runId,
    state: "retrying" as const,
    ...retry,
  };
  live.runStatus = notice;
  if (retry.failedEntryId) {
    live.hiddenEntryIds = Array.from(
      new Set([...(live.hiddenEntryIds ?? []), retry.failedEntryId]),
    );
  }
  removeLiveRunStatusTranscriptItem(view, runId);
  view.transcript = [
    ...view.transcript,
    {
      id: liveRunStatusId(runId),
      role: "system",
      kind: "run_status",
      displayKind: "message",
      text: "Retrying model request…",
      live: true,
      createdAt: event.ts,
      runStatus: notice,
    },
  ];
  if (view.activeRun && view.activeRun.runId === runId) {
    view.activeRun = { ...view.activeRun, status: "retrying", retry };
  }
  view.sending = true;
  view.error = undefined;
}
