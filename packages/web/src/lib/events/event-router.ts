import type { EventEnvelope, SessionEntry, ToolCallRecord } from "../api";
import { getProcessLogs } from "../api";
import { queryClient, queryKeys } from "../query";
import { selection } from "../state/app-state.svelte";
import {
  ensureConversationView,
  openSession,
  refreshSessionView,
} from "../stores/session-flow.svelte";
import { loadSettingsPanel } from "../stores/settings.svelte";
import {
  type LiveAssistantBlock,
  type LiveRunState,
  workbenchState,
} from "../stores/workbench/state.svelte";
import { entryToTranscriptItem } from "../stores/workbench/transcript";
import { loadWorkspaceState } from "../stores/workspace.svelte";

export function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
  if (isAgentStreamEvent(event)) handleAgentStreamEvent(event);
  if (event.type.startsWith("agent.tool_call.")) handleToolCallEvent(event);
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

export function isAgentStreamEvent(
  event: EventEnvelope<Record<string, unknown>>,
): boolean {
  return (
    event.type === "agent.prompt_received" ||
    event.type === "agent.message_started" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.message_content_delta" ||
    event.type === "agent.message_content_done" ||
    event.type === "agent.tool_call_draft.started" ||
    event.type === "agent.tool_call_draft.delta" ||
    event.type === "agent.tool_call_draft.done" ||
    event.type === "agent.message_complete" ||
    event.type === "agent.error"
  );
}

function emptyLiveRun(): LiveRunState {
  return { assistantStarted: false, blocks: [] };
}

function runIdFromEvent(
  event: EventEnvelope<Record<string, unknown>>,
): string | undefined {
  const runId = event.data?.runId;
  return typeof runId === "string" && runId.startsWith("run_")
    ? runId
    : undefined;
}

function ensureLiveRunState(
  liveRun: LiveRunState,
  runId?: string,
): LiveRunState {
  if (!runId || liveRun.runId === runId) {
    return {
      ...liveRun,
      runId: runId ?? liveRun.runId,
      assistantStarted: true,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    runId,
    assistantStarted: true,
    blocks: [],
    updatedAt: new Date().toISOString(),
  };
}

function sortLiveBlocks(blocks: LiveAssistantBlock[]): LiveAssistantBlock[] {
  return [...blocks].sort((a, b) => a.contentIndex - b.contentIndex);
}

function upsertLiveBlock(
  liveRun: LiveRunState,
  block: LiveAssistantBlock,
): LiveRunState {
  const index = liveRun.blocks.findIndex(
    (candidate) => candidate.contentIndex === block.contentIndex,
  );
  const blocks =
    index === -1
      ? [...liveRun.blocks, block]
      : liveRun.blocks.map((candidate, candidateIndex) =>
          candidateIndex === index ? block : candidate,
        );
  return {
    ...liveRun,
    blocks: sortLiveBlocks(blocks),
    updatedAt: new Date().toISOString(),
  };
}

function liveBlock(
  liveRun: LiveRunState,
  contentIndex: number,
): LiveAssistantBlock | undefined {
  return liveRun.blocks.find((block) => block.contentIndex === contentIndex);
}

function objectArgs(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sessionIdForAgentEvent(
  event: EventEnvelope<Record<string, unknown>>,
): string | undefined {
  const sessionId = event.data?.sessionId;
  if (typeof sessionId === "string" && sessionId.startsWith("ses_")) {
    return sessionId;
  }
  const entry = event.data?.entry as { sessionId?: unknown } | undefined;
  if (
    typeof entry?.sessionId === "string" &&
    entry.sessionId.startsWith("ses_")
  ) {
    return entry.sessionId;
  }
  const agentId = event.data?.agentId;
  if (typeof agentId !== "string") return undefined;
  return workbenchState.agents.find((agent) => agent.id === agentId)?.sessionId;
}

export function handleToolCallEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  const toolCall = event.data?.toolCall as ToolCallRecord | undefined;
  if (!toolCall) return;
  const sessionId = sessionIdForAgentEvent(event) ?? toolCall.sessionId;
  if (
    !sessionId ||
    !workbenchState.openConversationTabIds.includes(sessionId)
  ) {
    return;
  }
  const view = ensureConversationView(sessionId);
  const index = view.toolCalls.findIndex((entry) => entry.id === toolCall.id);
  view.toolCalls =
    index === -1
      ? [...view.toolCalls, toolCall]
      : view.toolCalls.map((entry) =>
          entry.id === toolCall.id ? toolCall : entry,
        );
}

export function handleAgentStreamEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  const sessionId = sessionIdForAgentEvent(event);
  if (
    !sessionId ||
    !workbenchState.openConversationTabIds.includes(sessionId)
  ) {
    return;
  }
  const view = ensureConversationView(sessionId);
  const active = selection.sessionId === sessionId;

  if (event.type === "agent.prompt_received") {
    const entry = event.data?.entry as SessionEntry | undefined;
    if (!entry) return;
    const item = entryToTranscriptItem(entry);
    const existingIndex = item.id
      ? view.transcript.findIndex((candidate) => candidate.id === item.id)
      : -1;
    if (existingIndex !== -1) {
      view.transcript = view.transcript.map((candidate, index) =>
        index === existingIndex ? item : candidate,
      );
    } else {
      let optimisticIndex = -1;
      for (let index = view.transcript.length - 1; index >= 0; index -= 1) {
        const candidate = view.transcript[index];
        if (
          candidate?.optimistic &&
          candidate.role === "user" &&
          candidate.text === item.text
        ) {
          optimisticIndex = index;
          break;
        }
      }
      view.transcript =
        optimisticIndex === -1
          ? [...view.transcript, item]
          : view.transcript.map((candidate, index) =>
              index === optimisticIndex ? item : candidate,
            );
    }
    if (active) {
      selection.entryId = item.id ?? selection.entryId;
      workbenchState.transcript = view.transcript;
    }
    return;
  }

  if (event.type === "agent.message_started") {
    view.liveRun = ensureLiveRunState(view.liveRun, runIdFromEvent(event));
    view.sending = true;
    if (active) workbenchState.sending = true;
    return;
  }

  if (event.type === "agent.message_content_delta") {
    const contentIndex = Number(event.data?.contentIndex);
    const delta = String(event.data?.delta ?? "");
    const kind = event.data?.kind;
    if (!Number.isFinite(contentIndex) || !delta) return;
    view.liveRun = ensureLiveRunState(view.liveRun, runIdFromEvent(event));
    const current = liveBlock(view.liveRun, contentIndex);
    if (kind === "thinking") {
      view.liveRun = upsertLiveBlock(view.liveRun, {
        kind: "thinking",
        contentIndex,
        text: current?.kind === "thinking" ? current.text + delta : delta,
        done: current?.kind === "thinking" ? current.done : undefined,
        redacted: current?.kind === "thinking" ? current.redacted : undefined,
      });
    } else if (kind === "text") {
      const text = current?.kind === "text" ? current.text + delta : delta;
      view.liveRun = upsertLiveBlock(view.liveRun, {
        kind: "text",
        contentIndex,
        text,
        done: current?.kind === "text" ? current.done : undefined,
      });
      view.streamingText = view.liveRun.blocks
        .filter((block) => block.kind === "text")
        .map((block) => block.text)
        .join("\n");
      if (active) workbenchState.streamingText = view.streamingText;
    }
    view.sending = true;
    if (active) workbenchState.sending = true;
    return;
  }

  if (event.type === "agent.message_content_done") {
    const contentIndex = Number(event.data?.contentIndex);
    const kind = event.data?.kind;
    if (!Number.isFinite(contentIndex)) return;
    view.liveRun = ensureLiveRunState(view.liveRun, runIdFromEvent(event));
    const current = liveBlock(view.liveRun, contentIndex);
    if (kind === "thinking") {
      view.liveRun = upsertLiveBlock(view.liveRun, {
        kind: "thinking",
        contentIndex,
        text:
          typeof event.data?.content === "string"
            ? event.data.content
            : current?.kind === "thinking"
              ? current.text
              : "",
        done: true,
        redacted: Boolean(event.data?.redacted),
      });
    } else if (kind === "text") {
      view.liveRun = upsertLiveBlock(view.liveRun, {
        kind: "text",
        contentIndex,
        text:
          typeof event.data?.content === "string"
            ? event.data.content
            : current?.kind === "text"
              ? current.text
              : "",
        done: true,
      });
      view.streamingText = view.liveRun.blocks
        .filter((block) => block.kind === "text")
        .map((block) => block.text)
        .join("\n");
      if (active) workbenchState.streamingText = view.streamingText;
    }
    return;
  }

  if (event.type === "agent.tool_call_draft.started") {
    const contentIndex = Number(event.data?.contentIndex);
    if (!Number.isFinite(contentIndex)) return;
    view.liveRun = ensureLiveRunState(view.liveRun, runIdFromEvent(event));
    view.liveRun = upsertLiveBlock(view.liveRun, {
      kind: "tool_call_draft",
      contentIndex,
      providerToolCallId:
        typeof event.data?.providerToolCallId === "string"
          ? event.data.providerToolCallId
          : undefined,
      toolName:
        typeof event.data?.toolName === "string"
          ? event.data.toolName
          : undefined,
      argsText: "",
    });
    return;
  }

  if (event.type === "agent.tool_call_draft.delta") {
    const contentIndex = Number(event.data?.contentIndex);
    const delta = String(event.data?.delta ?? "");
    if (!Number.isFinite(contentIndex) || !delta) return;
    view.liveRun = ensureLiveRunState(view.liveRun, runIdFromEvent(event));
    const current = liveBlock(view.liveRun, contentIndex);
    view.liveRun = upsertLiveBlock(view.liveRun, {
      kind: "tool_call_draft",
      contentIndex,
      providerToolCallId:
        current?.kind === "tool_call_draft"
          ? current.providerToolCallId
          : undefined,
      toolName:
        current?.kind === "tool_call_draft" ? current.toolName : undefined,
      argsText:
        current?.kind === "tool_call_draft" ? current.argsText + delta : delta,
      args: current?.kind === "tool_call_draft" ? current.args : undefined,
      done: current?.kind === "tool_call_draft" ? current.done : undefined,
    });
    return;
  }

  if (event.type === "agent.tool_call_draft.done") {
    const contentIndex = Number(event.data?.contentIndex);
    if (!Number.isFinite(contentIndex)) return;
    view.liveRun = ensureLiveRunState(view.liveRun, runIdFromEvent(event));
    const current = liveBlock(view.liveRun, contentIndex);
    const args = objectArgs(event.data?.args);
    view.liveRun = upsertLiveBlock(view.liveRun, {
      kind: "tool_call_draft",
      contentIndex,
      providerToolCallId:
        typeof event.data?.providerToolCallId === "string"
          ? event.data.providerToolCallId
          : current?.kind === "tool_call_draft"
            ? current.providerToolCallId
            : undefined,
      toolName:
        typeof event.data?.toolName === "string"
          ? event.data.toolName
          : current?.kind === "tool_call_draft"
            ? current.toolName
            : undefined,
      argsText: current?.kind === "tool_call_draft" ? current.argsText : "",
      args,
      done: true,
    });
    return;
  }

  if (event.type === "agent.message_delta") {
    if (view.liveRun.blocks.some((block) => block.kind === "text")) return;
    view.streamingText += String(event.data?.delta ?? "");
    view.sending = true;
    if (active) {
      workbenchState.streamingText = view.streamingText;
      workbenchState.sending = true;
    }
  }
  if (event.type === "agent.message_complete") {
    const entry = event.data?.entry as SessionEntry | undefined;
    const text =
      view.streamingText || entry?.text || String(event.data?.text ?? "");
    if (entry) {
      const item = entryToTranscriptItem(entry);
      const existingIndex = item.id
        ? view.transcript.findIndex((candidate) => candidate.id === item.id)
        : -1;
      view.transcript =
        existingIndex === -1
          ? [...view.transcript, item]
          : view.transcript.map((candidate, index) =>
              index === existingIndex ? item : candidate,
            );
    } else if (text) {
      view.transcript = [...view.transcript, { role: "assistant", text }];
    }
    view.streamingText = "";
    view.liveRun = emptyLiveRun();
    view.sending = false;
    view.error = undefined;
    if (active) {
      selection.entryId = entry?.id ?? selection.entryId;
      workbenchState.transcript = view.transcript;
      workbenchState.streamingText = "";
      workbenchState.sending = false;
      workbenchState.error = undefined;
    }
    void refreshSessionView(sessionId).then(() => {
      if (selection.sessionId === sessionId) void openSession(sessionId);
    });
  }
  if (event.type === "agent.error") {
    const aborted = Boolean(event.data?.aborted);
    view.error = aborted
      ? undefined
      : String(event.data?.message ?? "Agent error");
    view.sending = false;
    view.streamingText = "";
    view.liveRun = emptyLiveRun();
    if (active) {
      workbenchState.error = view.error;
      workbenchState.sending = false;
      workbenchState.streamingText = "";
    }
  }
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
    type.startsWith("agent.tool_call.") ||
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
