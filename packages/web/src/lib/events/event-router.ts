import type { EventEnvelope, SessionEntry, ToolCallRecord } from "../api";
import { getProcessLogs } from "../api";
import { queryClient, queryKeys } from "../query";
import { selection } from "../state/app-state.svelte";
import {
  activeRunToLegacyLive,
  ensureConversationView,
  liveTextFromLegacyLive,
  openSession,
  refreshSessionView,
} from "../stores/session-flow.svelte";
import { loadSettingsPanel } from "../stores/settings.svelte";
import type {
  ConversationLiveState,
  ConversationViewState,
  LiveToolOutput,
  TranscriptItem,
} from "../stores/workbench/state.svelte";
import { workbenchState } from "../stores/workbench/state.svelte";
import { entryToTranscriptItems } from "../stores/workbench/transcript";
import { loadWorkspaceState } from "../stores/workspace.svelte";

const MAX_LIVE_TOOL_OUTPUT_CHARS = 32_000;
const MAX_LIVE_TOOL_OUTPUT_CHUNKS = 400;

export function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
  if (event.seq && event.seq <= workbenchState.lastEventSeq) return;
  if (event.seq) workbenchState.lastEventSeq = event.seq;

  if (event.type.startsWith("conversation.")) {
    handleConversationEvent(event);
    return;
  }

  if (event.type === "process.log") {
    const processId = String(event.data?.processId ?? "");
    const viewingProcess =
      workbenchState.activeCenterTab?.kind === "process" &&
      workbenchState.activeCenterTab.id === processId;
    if (
      processId &&
      processId === workbenchState.selectedProcessId &&
      viewingProcess
    ) {
      void getProcessLogs(processId).then((logs) => {
        workbenchState.processLogs = logs;
      });
    }
    return;
  }

  if (shouldRefreshWorkspace(event.type)) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    void loadWorkspaceState();
    if (shouldRefreshSettings(event.type)) void loadSettingsPanel();
  }
}

function sessionIdFromEvent(
  event: EventEnvelope<Record<string, unknown>>,
): string | undefined {
  const sessionId = event.data?.sessionId;
  if (typeof sessionId === "string") return sessionId;
  const entry = event.data?.entry as { sessionId?: unknown } | undefined;
  if (typeof entry?.sessionId === "string") return entry.sessionId;
  const toolCall = event.data?.toolCall as { sessionId?: unknown } | undefined;
  if (typeof toolCall?.sessionId === "string") return toolCall.sessionId;
  return undefined;
}

function isOpenSession(sessionId: string): boolean {
  return workbenchState.openCenterTabs.some(
    (tab) => tab.kind === "conversation" && tab.id === sessionId,
  );
}

function active(sessionId: string): boolean {
  return selection.sessionId === sessionId;
}

function handleConversationEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  const sessionId = sessionIdFromEvent(event);
  if (!sessionId || !isOpenSession(sessionId)) return;
  const view = ensureConversationView(sessionId);
  if (event.seq <= view.cursorSeq) return;
  view.cursorSeq = event.seq;

  switch (event.type) {
    case "conversation.run.started":
      view.sending = true;
      view.error = undefined;
      break;
    case "conversation.entry.appended":
      handleEntryAppended(view, event.data?.entry as SessionEntry | undefined);
      break;
    case "conversation.tool_call.updated":
      handleToolCallUpdated(
        view,
        event.data?.toolCall as ToolCallRecord | undefined,
      );
      break;
    case "conversation.live.message.started":
      ensureLiveState(view, String(event.data?.runId ?? ""));
      view.sending = true;
      break;
    case "conversation.live.content.delta":
      handleContentDelta(view, event);
      break;
    case "conversation.live.content.done":
      handleContentDone(view, event);
      break;
    case "conversation.live.tool_draft.started":
      handleToolDraftStarted(view, event);
      break;
    case "conversation.live.tool_draft.delta":
      handleToolDraftDelta(view, event);
      break;
    case "conversation.live.tool_draft.done":
      handleToolDraftDone(view, event);
      break;
    case "conversation.live.tool_output.delta":
      handleToolOutputDelta(view, event);
      break;
    case "conversation.run.completed":
      view.sending = false;
      view.streamingText = "";
      view.live = emptyLiveState();
      view.activeRun = undefined;
      view.error = undefined;
      void refreshSessionView(sessionId).then(() => {
        if (selection.sessionId === sessionId) void openSession(sessionId);
      });
      break;
    case "conversation.run.failed":
      view.sending = false;
      view.streamingText = "";
      view.live = emptyLiveState();
      view.activeRun = undefined;
      view.error = event.data?.aborted
        ? undefined
        : String(event.data?.message ?? "Agent error");
      break;
  }

  syncActiveView(view);
}

function emptyLiveState(runId?: string): ConversationLiveState {
  return { runId, messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
}

function ensureLiveState(
  view: ConversationViewState,
  runId?: string,
): ConversationLiveState {
  if (!runId || view.live.runId === runId || !view.live.runId) {
    view.live = { ...view.live, runId: runId || view.live.runId };
    return view.live;
  }
  view.live = emptyLiveState(runId);
  return view.live;
}

function liveMessageId(data: Record<string, unknown>): string {
  return typeof data.liveMessageId === "string"
    ? data.liveMessageId
    : String(data.runId ?? "unknown");
}

function liveTextId(data: Record<string, unknown>): string {
  return `live:${liveMessageId(data)}:${String(data.kind ?? "text")}:${Number(data.contentIndex ?? 0)}`;
}

function handleEntryAppended(
  view: ConversationViewState,
  entry: SessionEntry | undefined,
): void {
  if (!entry) return;
  const items = entryToTranscriptItems(entry);
  const ids = new Set(items.map((item) => item.id).filter(Boolean));
  view.transcript = [
    ...view.transcript.filter((item) => !item.id || !ids.has(item.id)),
    ...items,
  ].filter((item, _index, all) => {
    if (!item.optimistic) return true;
    return !all.some(
      (candidate) =>
        !candidate.optimistic &&
        candidate.role === item.role &&
        candidate.text === item.text,
    );
  });
  if (entry.role === "assistant" && entry.liveMessageId) {
    view.live.messages = view.live.messages.filter(
      (item) => !item.id?.startsWith(`live:${entry.liveMessageId}:`),
    );
    view.streamingText = liveTextFromLegacyLive(view.live);
  }
}

function handleToolCallUpdated(
  view: ConversationViewState,
  toolCall: ToolCallRecord | undefined,
): void {
  if (!toolCall) return;
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

function handleContentDelta(
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
    void refreshSessionView(view.sessionId);
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

function handleContentDone(
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

function draftKey(data: Record<string, unknown>): string {
  return `live:${liveMessageId(data)}:tool-draft:${Number(data.contentIndex ?? 0)}`;
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
    sessionId: view.sessionId,
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
    done: typeof patch.done === "boolean" ? patch.done : current?.done,
    createdAt: current?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  view.live.toolDrafts = current
    ? view.live.toolDrafts.map((draft) => (draft.key === key ? updated : draft))
    : [...view.live.toolDrafts, updated];
}

function handleToolDraftStarted(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  ensureLiveState(
    view,
    typeof event.data?.runId === "string" ? event.data.runId : undefined,
  );
  upsertToolDraft(view, event, {});
}

function handleToolDraftDelta(
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
    void refreshSessionView(view.sessionId);
    return;
  }
  upsertToolDraft(view, event, {
    argsText: `${current?.argsText ?? ""}${delta}`,
  });
}

function handleToolDraftDone(
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

function capLiveOutput(output: LiveToolOutput): LiveToolOutput {
  let text = output.text;
  if (text.length > MAX_LIVE_TOOL_OUTPUT_CHARS) {
    text = text.slice(text.length - MAX_LIVE_TOOL_OUTPUT_CHARS);
  }
  const chunks =
    output.chunks.length > MAX_LIVE_TOOL_OUTPUT_CHUNKS
      ? output.chunks.slice(output.chunks.length - MAX_LIVE_TOOL_OUTPUT_CHUNKS)
      : output.chunks;
  return { ...output, text, chunks };
}

function handleToolOutputDelta(
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
  const previous = view.live.toolOutputByToolCallId[toolCallId];
  const expected = Number(event.data?.offset ?? previous?.text.length ?? 0);
  if (previous && previous.text.length > expected) return;
  if (previous && previous.text.length < expected) {
    void refreshSessionView(view.sessionId);
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
  });
  view.live.toolOutputByToolCallId = {
    ...view.live.toolOutputByToolCallId,
    [toolCallId]: output,
  };
}

function syncActiveView(view: ConversationViewState): void {
  if (!active(view.sessionId)) return;
  workbenchState.transcript = view.transcript;
  workbenchState.streamingText = view.streamingText;
  workbenchState.sending = view.sending;
  workbenchState.error = view.error;
}

export function shouldRefreshWorkspace(type: string): boolean {
  return (
    type === "session.created" ||
    type === "session.updated" ||
    type === "session.deleted" ||
    type === "session.compacted" ||
    type === "session.branch_summarized" ||
    type === "session.navigated" ||
    type === "project.deleted" ||
    type === "agent.created" ||
    type === "agent.status_changed" ||
    type.startsWith("agent.subagent_") ||
    type === "project.created" ||
    type.startsWith("approval.") ||
    type.startsWith("user_question.") ||
    type.startsWith("plan_review.") ||
    type === "plan.written" ||
    type === "agent.mode_changed" ||
    type === "conversation.tool_call.updated" ||
    type === "conversation.run.started" ||
    type === "conversation.run.completed" ||
    type === "conversation.run.failed" ||
    type.startsWith("process.") ||
    shouldRefreshSettings(type)
  );
}

export function shouldRefreshSettings(type: string): boolean {
  return (
    type.startsWith("settings.") ||
    type.startsWith("secrets.") ||
    type.startsWith("auth.")
  );
}

export { activeRunToLegacyLive };
