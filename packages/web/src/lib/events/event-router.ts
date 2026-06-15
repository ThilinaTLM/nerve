import { notifyNative } from "$lib/notifications/notify.svelte";
import type {
  AgentRecord,
  ConversationEntry,
  EventEnvelope,
  QueuedPromptRecord,
  SubscriptionUsage,
  ToolCallRecord,
} from "../api";
import { getConversationContextUsage, getProcessLogs } from "../api";
import { queryClient, queryKeys } from "../query";
import { selection } from "../state/app-state.svelte";
import {
  activeRunToLegacyLive,
  ensureConversationView,
  liveTextFromLegacyLive,
  openConversation,
  refreshConversationView,
} from "../stores/conversation-flow.svelte";
import {
  hasPendingSettingsSave,
  loadSettingsPanel,
} from "../stores/settings.svelte";
import {
  applyEntityEvent,
  patchKnownAgentStatus,
  upsertAgentRecordFresh,
} from "../stores/workbench/event-reducers";
import { invalidateGit } from "../stores/workbench/git-context.svelte";
import type {
  ConversationLiveState,
  ConversationViewState,
  LiveToolOutput,
  TranscriptItem,
} from "../stores/workbench/state.svelte";
import { workbenchState } from "../stores/workbench/state.svelte";
import { conversationViewKey } from "../stores/workbench/state-keys";
import { entryToTranscriptItems } from "../stores/workbench/transcript";
import { loadWorkspaceState } from "../stores/workspace.svelte";
import { notificationForRuntimeEvent } from "./runtime-notifications";

const MAX_LIVE_TOOL_OUTPUT_CHARS = 32_000;
const MAX_LIVE_TOOL_OUTPUT_CHUNKS = 400;
const CONTEXT_USAGE_REFRESH_DELAY_MS = 1000;
const contextUsageRefreshTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
const WORKSPACE_REFRESH_DEBOUNCE_MS = 150;
let workspaceRefreshTimer: ReturnType<typeof setTimeout> | undefined;

export function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
  if (event.seq && event.seq <= workbenchState.lastEventSeq) return;
  if (event.seq) workbenchState.lastEventSeq = event.seq;
  applyEntityEvent(event);
  patchRuntimeAgentStatus(event);
  maybeShowRuntimeNotification(event);

  if (isConversationRuntimeEvent(event.type)) {
    handleConversationEvent(event);
    return;
  }

  if (event.type === "usage.subscription.updated") {
    const usage = event.data as SubscriptionUsage | undefined;
    if (usage?.provider) {
      workbenchState.subscriptionUsage = {
        ...workbenchState.subscriptionUsage,
        [usage.provider]: usage,
      };
    }
    return;
  }

  if (
    event.type === "conversation.compacted" ||
    event.type === "conversation.navigated"
  ) {
    const conversationId = conversationIdFromEvent(event);
    if (conversationId && isOpenConversation(conversationId))
      void refreshConversationView(conversationId);
  }

  if (isAgentRecordEvent(event.type)) {
    const agent = agentRecordFromEvent(event.data?.agent);
    if (agent) applyAgentRecord(agent);
  }

  if (event.type === "agent.configured") {
    const agent = event.data?.agent as { conversationId?: unknown } | undefined;
    if (typeof agent?.conversationId === "string") {
      void refreshContextUsage(agent.conversationId);
    }
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
    scheduleWorkspaceRefresh();
    if (
      shouldRefreshSettings(event.type) &&
      !(event.type.startsWith("settings.") && hasPendingSettingsSave())
    ) {
      void loadSettingsPanel();
    }
  }
}

function scheduleWorkspaceRefresh(): void {
  if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer);
  workspaceRefreshTimer = setTimeout(() => {
    workspaceRefreshTimer = undefined;
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    void loadWorkspaceState();
  }, WORKSPACE_REFRESH_DEBOUNCE_MS);
}

function maybeShowRuntimeNotification(
  event: EventEnvelope<Record<string, unknown>>,
): void {
  if (!isRecentEvent(event)) return;
  const candidate = notificationForRuntimeEvent(event, {
    projects: workbenchState.projects,
    conversations: workbenchState.conversations,
  });
  if (!candidate) return;

  notifyNative(candidate.payload, {
    backgroundOnly: candidate.backgroundOnly,
    kind: candidate.kind,
    tag: candidate.tag,
  });
}

function isRecentEvent(event: EventEnvelope<Record<string, unknown>>): boolean {
  const ts = Date.parse(event.ts);
  return Number.isFinite(ts) && Date.now() - ts < 60_000;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isConversationRuntimeEvent(type: string): boolean {
  return (
    type === "conversation.entry.appended" ||
    type === "conversation.context.updated" ||
    type === "conversation.tool_call.updated" ||
    type.startsWith("conversation.prompt.") ||
    type.startsWith("conversation.run.") ||
    type.startsWith("conversation.live.")
  );
}

function conversationIdFromEvent(
  event: EventEnvelope<Record<string, unknown>>,
): string | undefined {
  const conversationId = event.data?.conversationId;
  if (typeof conversationId === "string") return conversationId;
  const entry = event.data?.entry as { conversationId?: unknown } | undefined;
  if (typeof entry?.conversationId === "string") return entry.conversationId;
  const toolCall = event.data?.toolCall as
    | { conversationId?: unknown }
    | undefined;
  if (typeof toolCall?.conversationId === "string")
    return toolCall.conversationId;
  return undefined;
}

function isOpenConversation(conversationId: string): boolean {
  return workbenchState.openCenterTabs.some(
    (tab) => tab.kind === "conversation" && tab.id === conversationId,
  );
}

function active(conversationId: string): boolean {
  return selection.conversationId === conversationId;
}

function isAgentRecordEvent(type: string): boolean {
  return (
    type === "agent.created" ||
    type === "agent.configured" ||
    type === "agent.mode_changed" ||
    type === "agent.status_changed"
  );
}

function agentRecordFromEvent(value: unknown): AgentRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AgentRecord>;
  return typeof candidate.id === "string" &&
    typeof candidate.updatedAt === "string"
    ? (candidate as AgentRecord)
    : undefined;
}

function applyAgentRecord(agent: AgentRecord): void {
  upsertAgentRecordFresh(agent);
}

function patchRuntimeAgentStatus(
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const agentId = stringValue(event.data?.agentId);
  switch (event.type) {
    case "conversation.run.started":
      patchKnownAgentStatus(agentId, "running", event.ts);
      break;
    case "conversation.run.suspended":
      patchKnownAgentStatus(agentId, "awaiting_user", event.ts);
      break;
    case "conversation.run.completed":
      patchKnownAgentStatus(agentId, "idle", event.ts);
      break;
    case "conversation.run.failed":
      patchKnownAgentStatus(
        agentId,
        event.data?.aborted ? "aborted" : "error",
        event.ts,
      );
      break;
  }
}

function handleConversationEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  const conversationId = conversationIdFromEvent(event);
  if (!conversationId || !isOpenConversation(conversationId)) return;
  const view = ensureConversationView(conversationId);
  if (event.seq <= view.cursorSeq) return;
  view.cursorSeq = event.seq;

  switch (event.type) {
    case "conversation.run.started":
      view.sending = true;
      view.queuedPrompts = [];
      view.error = undefined;
      break;
    case "conversation.entry.appended":
      if (
        !handleEntryAppended(
          view,
          event.data?.entry as ConversationEntry | undefined,
        )
      ) {
        void refreshConversationView(conversationId);
      }
      scheduleContextUsageRefresh(conversationId);
      break;
    case "conversation.context.updated":
      clearContextUsageRefresh(conversationId);
      view.contextUsage =
        (event.data?.contextUsage as ConversationViewState["contextUsage"]) ??
        view.contextUsage;
      break;
    case "conversation.prompt.queued":
      upsertQueuedPrompt(
        view,
        event.data?.queuedPrompt as QueuedPromptRecord | undefined,
      );
      break;
    case "conversation.prompt.dequeued":
    case "conversation.prompt.cancelled":
      removeQueuedPrompt(
        view,
        event.data?.queuedPrompt as QueuedPromptRecord | undefined,
      );
      break;
    case "conversation.tool_call.updated":
      handleToolCallUpdated(
        view,
        event.data?.toolCall as ToolCallRecord | undefined,
      );
      break;
    case "conversation.run.retrying":
      handleRunRetrying(view, event);
      break;
    case "conversation.live.message.started":
      ensureLiveState(view, String(event.data?.runId ?? ""));
      view.live.runStatus = undefined;
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
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
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
      view.sending = false;
      view.streamingText = "";
      view.live = emptyLiveState();
      view.activeRun = undefined;
      view.queuedPrompts = [];
      view.error = undefined;
      void refreshConversationView(conversationId).then(() => {
        if (selection.conversationId === conversationId)
          void openConversation(conversationId);
      });
      if (active(conversationId)) {
        void invalidateGit(stringValue(event.data?.projectId));
      }
      break;
    case "conversation.run.failed":
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
      view.sending = false;
      view.streamingText = "";
      view.live = emptyLiveState();
      view.activeRun = undefined;
      view.queuedPrompts = [];
      view.error = event.data?.aborted
        ? undefined
        : String(event.data?.message ?? "Agent error");
      break;
    case "conversation.run.suspended":
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
      view.sending = false;
      view.streamingText = "";
      view.live = emptyLiveState();
      view.activeRun = undefined;
      view.queuedPrompts = [];
      view.error = undefined;
      break;
  }

  syncActiveView(view);
}

function upsertQueuedPrompt(
  view: ConversationViewState,
  queuedPrompt: QueuedPromptRecord | undefined,
): void {
  if (!queuedPrompt) return;
  const index = view.queuedPrompts.findIndex(
    (candidate) => candidate.id === queuedPrompt.id,
  );
  view.queuedPrompts =
    index === -1
      ? [...view.queuedPrompts, queuedPrompt]
      : view.queuedPrompts.map((candidate) =>
          candidate.id === queuedPrompt.id ? queuedPrompt : candidate,
        );
}

function removeQueuedPrompt(
  view: ConversationViewState,
  queuedPrompt: QueuedPromptRecord | undefined,
): void {
  if (!queuedPrompt) return;
  view.queuedPrompts = view.queuedPrompts.filter(
    (candidate) => candidate.id !== queuedPrompt.id,
  );
}

function emptyLiveState(runId?: string): ConversationLiveState {
  return { runId, messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function liveRunStatusId(runId: string): string {
  return `live:run-status:${runId || "active"}`;
}

function removeLiveRunStatusTranscriptItem(
  view: ConversationViewState,
  runId?: string,
): void {
  view.transcript = view.transcript.filter((item) => {
    if (!item.runStatus || item.runStatus.state !== "retrying") return true;
    return Boolean(runId && item.runStatus.runId !== runId);
  });
}

function entryBelongsToActiveBranch(
  view: ConversationViewState,
  entry: ConversationEntry,
): boolean {
  const existingIndex = view.activeEntryIds.indexOf(entry.id);
  if (existingIndex !== -1) return true;
  const activeLeafId = view.activeEntryId ?? view.activeEntryIds.at(-1);
  if (activeLeafId) return entry.parentEntryId === activeLeafId;
  return view.activeEntryIds.length === 0 && !entry.parentEntryId;
}

function updateActiveBranchPath(
  view: ConversationViewState,
  entry: ConversationEntry,
): void {
  const existingIndex = view.activeEntryIds.indexOf(entry.id);
  if (existingIndex !== -1) {
    view.activeEntryIds = view.activeEntryIds.slice(0, existingIndex + 1);
  } else {
    view.activeEntryIds = [...view.activeEntryIds, entry.id];
  }
  view.activeEntryId = entry.id;
}

function updateConversationActiveEntryId(
  conversationId: string,
  entryId: string,
): void {
  workbenchState.conversations = workbenchState.conversations.map(
    (conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            activeEntryId: entryId,
            updatedAt: new Date().toISOString(),
          }
        : conversation,
  );
}

function updateTreeNodesForEntry(
  view: ConversationViewState,
  entry: ConversationEntry,
): void {
  const existing = view.treeNodes.find((node) => node.entry.id === entry.id);
  if (existing) {
    view.treeNodes = view.treeNodes.map((node) =>
      node.entry.id === entry.id ? { ...node, entry } : node,
    );
    return;
  }

  view.treeNodes = [
    ...view.treeNodes.map((node) =>
      entry.parentEntryId && node.entry.id === entry.parentEntryId
        ? {
            ...node,
            childEntryIds: Array.from(
              new Set([...node.childEntryIds, entry.id]),
            ),
          }
        : node,
    ),
    { entry, childEntryIds: [] },
  ];
}

function handleRunRetrying(
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
  return true;
}

function handleToolCallUpdated(
  view: ConversationViewState,
  toolCall: ToolCallRecord | undefined,
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
    void refreshConversationView(view.conversationId);
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
  });
  view.live.toolOutputByToolCallId = {
    ...view.live.toolOutputByToolCallId,
    [toolCallId]: output,
  };
}

function clearContextUsageRefresh(conversationId: string): void {
  const timer = contextUsageRefreshTimers.get(conversationId);
  if (!timer) return;
  clearTimeout(timer);
  contextUsageRefreshTimers.delete(conversationId);
}

function scheduleContextUsageRefresh(conversationId: string): void {
  if (!isOpenConversation(conversationId)) return;
  clearContextUsageRefresh(conversationId);
  const timer = setTimeout(() => {
    contextUsageRefreshTimers.delete(conversationId);
    void refreshContextUsage(conversationId);
  }, CONTEXT_USAGE_REFRESH_DELAY_MS);
  contextUsageRefreshTimers.set(conversationId, timer);
}

async function refreshContextUsage(conversationId: string): Promise<void> {
  if (!isOpenConversation(conversationId)) return;
  const contextUsage = await getConversationContextUsage(conversationId).catch(
    () => undefined,
  );
  const view =
    workbenchState.conversationViews[conversationViewKey(conversationId)];
  if (!contextUsage || !view) return;
  view.contextUsage = contextUsage;
}

function syncActiveView(view: ConversationViewState): void {
  if (!active(view.conversationId)) return;
  workbenchState.treeNodes = view.treeNodes;
  workbenchState.transcript = view.transcript;
  workbenchState.streamingText = view.streamingText;
  workbenchState.sending = view.sending;
  workbenchState.error = view.error;
}

export function shouldRefreshWorkspace(type: string): boolean {
  return (
    type === "conversation.created" ||
    type === "conversation.updated" ||
    type === "conversation.deleted" ||
    type === "conversation.compacted" ||
    type === "conversation.branch_summarized" ||
    type === "conversation.navigated" ||
    type === "project.deleted" ||
    type === "agent.created" ||
    type === "agent.configured" ||
    type === "agent.status_changed" ||
    type.startsWith("agent.subagent_") ||
    type.startsWith("agent.explore_") ||
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
    type === "conversation.run.suspended" ||
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
