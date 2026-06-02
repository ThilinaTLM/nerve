import type { EventEnvelope } from "../api";
import { getProcessLogs } from "../api";
import { queryClient, queryKeys } from "../query";
import { selection } from "../state/app-state.svelte";
import { openSession } from "../stores/session-flow.svelte";
import { loadSettingsPanel } from "../stores/settings.svelte";
import { workbenchState } from "../stores/workbench/state.svelte";
import { loadWorkspaceState } from "../stores/workspace.svelte";

export function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
  if (isSelectedAgentStreamEvent(event)) handleSelectedAgentStreamEvent(event);
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

export function isSelectedAgentStreamEvent(
  event: EventEnvelope<Record<string, unknown>>,
): boolean {
  if (
    event.type !== "agent.message_delta" &&
    event.type !== "agent.message_complete" &&
    event.type !== "agent.error"
  ) {
    return false;
  }
  const agentId = event.data?.agentId;
  return !agentId || agentId === selection.agentId;
}

export function handleSelectedAgentStreamEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  if (event.type === "agent.message_delta") {
    workbenchState.streamingText += String(event.data?.delta ?? "");
  }
  if (event.type === "agent.message_complete") {
    const entry = event.data?.entry as
      | { id?: string; text?: string }
      | undefined;
    const text =
      workbenchState.streamingText ||
      entry?.text ||
      String(event.data?.text ?? "");
    if (text) {
      workbenchState.transcript = [
        ...workbenchState.transcript,
        { id: entry?.id, role: "assistant", text },
      ];
    }
    selection.entryId = entry?.id ?? selection.entryId;
    workbenchState.streamingText = "";
    workbenchState.sending = false;
    if (selection.sessionId) void openSession(selection.sessionId);
  }
  if (event.type === "agent.error") {
    workbenchState.error = String(event.data?.message ?? "Agent error");
    workbenchState.sending = false;
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
