import { dispatchEvent } from "$lib/core/events/event-bus";
import {
  clearLiveCompaction,
  conversationIdFromEvent,
  handleConversationEvent,
  isConversationRuntimeEvent,
  isOpenConversation,
  refreshContextUsage,
} from "$lib/features/conversations/state/conversation-events";
import type { AgentRecord, EventEnvelope, SubscriptionUsage } from "../api";
import { getProcessLogs } from "../api";
import { queryClient, queryKeys } from "../query";
import { refreshConversationView } from "../stores/conversation-flow.svelte";
import {
  hasPendingSettingsSave,
  loadSettingsPanel,
} from "../stores/settings.svelte";
import {
  applyEntityEvent,
  patchKnownAgentStatus,
  upsertAgentRecordFresh,
} from "../stores/workbench/event-reducers";
import { workbenchState } from "../stores/workbench/state.svelte";
import { loadWorkspaceState } from "../stores/workspace.svelte";

const WORKSPACE_REFRESH_DEBOUNCE_MS = 150;
let workspaceRefreshTimer: ReturnType<typeof setTimeout> | undefined;

export function handleEvent(event: EventEnvelope<Record<string, unknown>>) {
  if (event.seq && event.seq <= workbenchState.lastEventSeq) return;
  if (event.seq) workbenchState.lastEventSeq = event.seq;
  applyEntityEvent(event);
  patchRuntimeAgentStatus(event);
  dispatchEvent(event);

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
    if (conversationId && isOpenConversation(conversationId)) {
      if (event.type === "conversation.compacted") {
        clearLiveCompaction(conversationId, event);
      }
      void refreshConversationView(conversationId);
    }
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
