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
import { workbenchState } from "../stores/workbench/state.svelte";
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
    event.type === "agent.message_delta" ||
    event.type === "agent.message_complete" ||
    event.type === "agent.error"
  );
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

  if (event.type === "agent.message_delta") {
    view.streamingText += String(event.data?.delta ?? "");
    view.sending = true;
    if (active) {
      workbenchState.streamingText = view.streamingText;
      workbenchState.sending = true;
    }
  }
  if (event.type === "agent.message_complete") {
    const entry = event.data?.entry as
      | { id?: string; text?: string }
      | undefined;
    const text =
      view.streamingText || entry?.text || String(event.data?.text ?? "");
    if (text) {
      view.transcript = [
        ...view.transcript,
        { id: entry?.id, role: "assistant", text },
      ];
    }
    view.streamingText = "";
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
    type.startsWith("agent.tool_call") ||
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
