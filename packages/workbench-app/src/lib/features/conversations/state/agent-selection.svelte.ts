import { SvelteMap } from "svelte/reactivity";
import { applyConversationNotification } from "$lib/presentation/state";
import type { NotifyEvent } from "@nervekit/contracts/events";
import type { EventEnvelope } from "$lib/api";
import { applySubagentTranscriptEvent } from "$lib/presentation/state/subagent-transcript-session";
import type { AgentRecord } from "$lib/api";
import { protocolRequest } from "@nervekit/protocol/adapters";
import {
  conversationState,
  type ConversationViewState,
} from "./conversation-state.svelte";
import { ensureConversationView } from "./conversation-view-actions";
import { selection } from "$lib/application/workspace/selection.svelte";
import {
  upsertAgentRecordFresh,
  upsertAgentActivity,
} from "$lib/application/workspace/entity-reducers";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { modelKey } from "$lib/presentation/utils/model";
import { voiceInputSession } from "$lib/features/conversations/audio/voice-input-session.svelte";
import { agentUsesConversationView } from "./agent-history-ownership";
import { applyQueueRefresh } from "./conversation-refresh";
import { applyAgentHistory } from "./agent-history-state";
import {
  beginHistoryRefresh,
  failHistoryRefresh,
  historyExecutionError,
} from "./history-health";
import { refreshConversationView } from "./conversation-selection";
import { mainAgentForConversation } from "./main-agent";
import { AgentEventBuffer } from "./agent-event-buffer";
import { KeyedSingleFlight } from "./keyed-single-flight";

export function selectedConversationAgent(
  conversationId: string,
): AgentRecord | undefined {
  const id = conversationState.selectedAgentIds[conversationId];
  const selected = workspaceState.agents.find(
    (agent) => agent.id === id && agent.conversationId === conversationId,
  );
  const conversation = workspaceState.conversations.find(
    (record) => record.id === conversationId,
  );
  return (
    selected ??
    (conversation
      ? mainAgentForConversation(conversation, workspaceState.agents)
      : undefined)
  );
}

export function ensureAgentView(agent: AgentRecord): ConversationViewState {
  if (agentUsesConversationView(agent))
    return ensureConversationView(agent.conversationId);
  conversationState.agentViews[agent.id] ??= {
    conversationId: agent.conversationId,
    activeEntryIds: [],
    entries: [],
    toolCalls: [],
    treeNodes: [],
    optimisticMessages: [],
    queuedPrompts: [],
    cursorSeq: 0,
    sending: false,
    stopping: false,
    composerText: "",
    loading: false,
    recoveryIssues: [],
  };
  return conversationState.agentViews[agent.id];
}

export function selectedConversationView(
  conversationId: string,
): ConversationViewState {
  const agent = selectedConversationAgent(conversationId);
  return agent
    ? ensureAgentView(agent)
    : ensureConversationView(conversationId);
}

const refreshes = new KeyedSingleFlight<string, void>();
const eventBuffers = new SvelteMap<string, AgentEventBuffer>();
const notificationBuffers = new SvelteMap<
  string,
  NotifyEvent<Record<string, unknown>>[]
>();
export function applyAgentViewNotification(
  agent: AgentRecord,
  event: NotifyEvent<Record<string, unknown>>,
): void {
  const view = conversationState.agentViews[agent.id];
  if (!view) return;
  const buffer = notificationBuffers.get(agent.id);
  if (buffer) {
    buffer.push(event);
    return;
  }
  try {
    Object.assign(
      view,
      applyConversationNotification(view, event, {
        retainHiddenToolCalls: true,
        onGap: () => {
          void reconcileAgentView(agent);
        },
      }),
    );
  } catch {
    void reconcileAgentView(agent);
  }
}
function eventBuffer(agentId: string): AgentEventBuffer {
  let buffer = eventBuffers.get(agentId);
  if (!buffer) {
    buffer = new AgentEventBuffer();
    eventBuffers.set(agentId, buffer);
  }
  return buffer;
}
export function applyAgentViewEvent(
  agent: AgentRecord,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const view = conversationState.agentViews[agent.id];
  if (!view) return;
  if (!eventBuffer(agent.id).accept(event)) return;
  applyEventToView(agent, event);
}
function applyEventToView(
  agent: AgentRecord,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const view = ensureAgentView(agent);
  try {
    Object.assign(
      view,
      applySubagentTranscriptEvent(view, event, () => {
        void reconcileAgentView(agent);
      }),
    );
  } catch {
    void reconcileAgentView(agent);
  }
}
export async function reconcileAgentView(agent: AgentRecord): Promise<void> {
  const hydrationInFlight = ensureAgentView(agent).loading;
  await refreshAgentView(agent);
  // A terminal event or offset gap arriving during hydration needs a newer
  // snapshot, not merely the already-running request's result.
  if (hydrationInFlight) await refreshAgentView(agent);
}

export function refreshAgentView(agent: AgentRecord): Promise<void> {
  if (agentUsesConversationView(agent))
    return refreshConversationView(agent.conversationId);
  return refreshes.run(agent.id, async () => {
    const view = ensureAgentView(agent);
    view.loading = true;
    const token = beginHistoryRefresh(view, agent.id);
    const baselineCursor = view.cursorSeq;
    let historyFailure: { error: unknown } | undefined;
    eventBuffer(agent.id).begin();
    notificationBuffers.set(agent.id, []);
    try {
      const [history, queue] = await Promise.allSettled([
        protocolRequest("agent.history.get", { agentId: agent.id }),
        protocolRequest("agent.promptQueue.list", { agentId: agent.id }),
      ]);
      applyQueueRefresh(
        view,
        queue.status === "fulfilled"
          ? { status: "fulfilled", value: queue.value.result.queuedPrompts }
          : queue,
        agent.id,
      );
      if (history.status === "rejected") {
        historyFailure = { error: history.reason };
      } else {
        try {
          if (applyAgentHistory(view, agent, history.value.result)) {
            if (history.value.result.activity)
              upsertAgentActivity(history.value.result.activity);
            view.optimisticMessages = [];
            view.error = undefined;
            for (const event of eventBuffer(agent.id).finish(
              history.value.result.cursorSeq ?? -1,
            ))
              applyEventToView(agent, event);
          }
        } catch (error) {
          // Do not adopt the payload's claimed owner. This current request is
          // unverified for its requested actor; stale generations stay guarded.
          historyFailure = { error };
        }
      }
    } catch (error) {
      view.error = error instanceof Error ? error.message : String(error);
    } finally {
      for (const event of eventBuffer(agent.id).finish(-1))
        applyEventToView(agent, event);
      const notifications = notificationBuffers.get(agent.id) ?? [];
      notificationBuffers.delete(agent.id);
      for (const notification of notifications)
        applyAgentViewNotification(agent, notification);
      // A buffered newer event can prove this failed fetch stale. Do not let
      // that response poison an already verified selected actor's health.
      if (historyFailure)
        failHistoryRefresh(
          view,
          agent.id,
          token,
          baselineCursor,
          historyFailure.error,
        );
      view.loading = false;
    }
  });
}

let selectionEpoch = 0;
export async function selectConversationAgent(
  agent: AgentRecord,
): Promise<void> {
  const epoch = ++selectionEpoch;
  await voiceInputSession.cancel();
  if (epoch !== selectionEpoch) return;
  conversationState.selectedAgentIds[agent.conversationId] = agent.id;
  selection.agentId = agent.id;
  selection.projectId = agent.projectId;
  selection.conversationId = agent.conversationId;
  selection.entryId = undefined;
  composerSelectionForAgent(agent);
  await refreshAgentView(agent);
}

export function composerSelectionForAgent(agent: AgentRecord): void {
  conversationState.selectedModelKey = agent.model ? modelKey(agent.model) : "";
  conversationState.selectedThinkingLevel = agent.thinkingLevel ?? "off";
  conversationState.selectedMode = agent.mode;
  conversationState.selectedPermissionLevel = agent.permissionLevel;
  conversationState.selectedPermissionRuleSetId =
    agent.permissionRuleSetId ?? agent.permissionLevel;
}

export async function controlAgent(
  agent: AgentRecord,
  operation: "agent.stop" | "agent.resume",
): Promise<void> {
  const view = ensureAgentView(agent);
  if (operation === "agent.resume" && historyExecutionError(view, agent.id))
    return;
  if (view.stopping) return;
  view.stopping = true;
  view.error = undefined;
  try {
    await protocolRequest(
      operation,
      { agentId: agent.id },
      { idempotencyKey: crypto.randomUUID() },
    );
    const { result } = await protocolRequest("agent.get", {
      agentId: agent.id,
    });
    upsertAgentRecordFresh(result.agent);
    await refreshAgentView(result.agent);
  } catch (error) {
    view.error = error instanceof Error ? error.message : String(error);
  } finally {
    view.stopping = false;
  }
}
