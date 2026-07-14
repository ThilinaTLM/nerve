import type { AgentRecord } from "$lib/api";
import { onAnyEvent, type WorkbenchEvent } from "$lib/core/events/event-bus";
import { queryClient, queryKeys } from "$lib/core/query";
import {
  applyEntityEvent,
  patchKnownAgentStatus,
  upsertAgentRecordFresh,
} from "./entity-reducers";
import { loadWorkspaceState } from "./workspace-actions.svelte";
import {
  runtimeAgentStatusFromEvent,
  shouldRefreshWorkspace,
} from "./workspace-event-policy";

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
  const status = runtimeAgentStatusFromEvent(event.type, event.data);
  if (!status) return;
  patchKnownAgentStatus(stringValue(event.data?.agentId), status, event.ts);
}
