import type { EventEnvelope } from "../api";
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
import { loadWorkspaceState } from "../stores/workspace.svelte";

export function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
  if (isAgentStreamEvent(event)) handleAgentStreamEvent(event);
  if (event.type === "process.log") {
    const processId = String(event.data?.processId ?? "");
    if (processId && processId === workbenchState.selectedProcessId) {
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
  const agentId = event.data?.agentId;
  if (typeof agentId !== "string") return undefined;
  return workbenchState.agents.find((agent) => agent.id === agentId)?.sessionId;
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
