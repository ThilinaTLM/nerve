import type { AgentRecord } from "$lib/api";
import { onAnyEvent, type WorkbenchEvent } from "$lib/core/events/event-bus";
import { queryClient, queryKeys } from "$lib/core/query";
import {
  applyEntityEvent,
  patchKnownAgentStatus,
  upsertAgentRecordFresh,
} from "./entity-reducers";
import { loadWorkspaceState } from "./workspace-actions.svelte";

const WORKSPACE_REFRESH_DEBOUNCE_MS = 150;
let workspaceRefreshTimer: ReturnType<typeof setTimeout> | undefined;

export function registerWorkspaceEventHandlers(): () => void {
  return onAnyEvent(handleWorkspaceEvent);
}

function handleWorkspaceEvent(event: WorkbenchEvent): void {
  applyEntityEvent(event);
  patchRuntimeAgentStatus(event);

  if (isAgentRecordEvent(event.type)) {
    const agent = agentRecordFromEvent(event.data?.agent);
    if (agent) upsertAgentRecordFresh(agent);
  }

  if (shouldRefreshWorkspace(event.type)) scheduleWorkspaceRefresh();
}

function scheduleWorkspaceRefresh(): void {
  if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer);
  workspaceRefreshTimer = setTimeout(() => {
    workspaceRefreshTimer = undefined;
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    void loadWorkspaceState();
  }, WORKSPACE_REFRESH_DEBOUNCE_MS);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function patchRuntimeAgentStatus(event: WorkbenchEvent): void {
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
