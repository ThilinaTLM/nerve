import { applyRequestedHistoryRefresh } from "./requested-history-refresh";
import { modelKey } from "$lib/presentation/utils/model";
import { protocolRequest } from "@nervekit/protocol/adapters";
import {
  applyCanonicalConversationSnapshot,
  applyQueueRefresh,
} from "./conversation-refresh";
import {
  type AgentRecord,
  type ConversationRecord,
  getConversationSnapshotWithCursor,
  getProject,
  type ProjectRecord,
} from "$lib/api";
import { voiceInputSession } from "$lib/features/conversations/audio/voice-input-session.svelte";
import { installEventCursors } from "$lib/application/event-routing/stream-cursors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { agentConfigOverride } from "$lib/features/conversations/state/agent-config-mutations.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import {
  upsertConversationActivity,
  upsertAgentActivity,
} from "$lib/application/workspace/entity-reducers";
import { KeyedSingleFlight } from "$lib/features/conversations/state/keyed-single-flight";
import {
  replaceOpenCenterTabs,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import {
  composerDraft,
  selection,
} from "$lib/application/workspace/selection.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { agentUsesConversationView } from "./agent-history-ownership";
import {
  beginHistoryRefresh,
  failHistoryRefresh,
  settleConversationRefresh,
} from "./history-health";
import { mainAgentForConversation } from "./main-agent";
import {
  selectedConversationAgent,
  refreshAgentView,
} from "./agent-selection.svelte";
import {
  clearActiveSelection,
  ensureConversationView,
  persistConversationTabs,
} from "./conversation-view-actions";

async function projectForConversation(
  conversation: ConversationRecord,
): Promise<ProjectRecord> {
  return (
    workspaceState.projects.find(
      (candidate) => candidate.id === conversation.projectId,
    ) ?? (await getProject(conversation.projectId))
  );
}

import { clearContextUsageRefresh } from "./conversation-context-usage";

export async function applyActiveConversationSelection(
  conversation: ConversationRecord,
) {
  if (selection.conversationId)
    clearContextUsageRefresh(selection.conversationId);
  clearContextUsageRefresh(conversation.id);
  selection.conversationId = conversation.id;
  selection.projectId = conversation.projectId;
  const conversationAgent =
    selectedConversationAgent(conversation.id) ??
    mainAgentForConversation(conversation, workspaceState.agents);
  selection.agentId = conversationAgent?.id;
  if (conversationAgent && !agentUsesConversationView(conversationAgent))
    void refreshAgentView(conversationAgent);
  selection.entryId = conversation.activeEntryId;
  const project = await projectForConversation(conversation);
  composerDraft.projectDir = project.dir;
  // A pending desired override survives tab switches: it stays the display
  // value for its agent until the in-flight configuration mutation settles.
  const override = agentConfigOverride(conversationAgent?.id);
  const overrideModel = override?.model ?? undefined;
  if (overrideModel) {
    conversationState.selectedModelKey = modelKey(overrideModel);
  } else if (conversationAgent?.model) {
    conversationState.selectedModelKey = modelKey(conversationAgent.model);
  } else {
    conversationState.selectedModelKey = "";
  }
  conversationState.selectedThinkingLevel =
    override?.thinkingLevel ?? conversationAgent?.thinkingLevel ?? "off";
  conversationState.selectedMode =
    override?.mode ?? conversationAgent?.mode ?? conversation.mode;
  conversationState.selectedPermissionLevel =
    override?.permissionLevel ??
    conversationAgent?.permissionLevel ??
    conversation.permissionLevel;
  conversationState.selectedPermissionRuleSetId =
    override?.permissionRuleSetId ??
    conversationAgent?.permissionRuleSetId ??
    conversationAgent?.permissionLevel ??
    conversation.permissionLevel;
}

const conversationSnapshotRefreshes = new KeyedSingleFlight<string, void>();
const conversationRecoveryRefreshes = new KeyedSingleFlight<string, void>();

export function recoverAndRefreshConversation(
  conversationId: string,
): Promise<void> {
  return conversationRecoveryRefreshes.run(conversationId, async () => {
    const view = ensureConversationView(conversationId);
    view.loading = true;
    view.error = undefined;
    try {
      const requestId = crypto.randomUUID();
      const recovery = await protocolRequest(
        "conversation.reconcile",
        { conversationId, requestId },
        { idempotencyKey: requestId },
      );
      view.recoveryIssues = recovery.result.recoveryIssues;
      if (recovery.result.unknownOutcomes > 0) {
        notify.message("Recovery needs review", {
          description: `${recovery.result.unknownOutcomes} external operation outcome${recovery.result.unknownOutcomes === 1 ? " is" : "s are"} unknown. No operation was repeated.`,
        });
      }
      await refreshConversationView(conversationId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      view.error = message;
      notify.error("Conversation recovery failed", { description: message });
    } finally {
      view.loading = false;
    }
  });
}

export function refreshConversationView(conversationId: string): Promise<void> {
  return conversationSnapshotRefreshes.run(conversationId, async () => {
    const view = ensureConversationView(conversationId);
    view.loading = true;
    try {
      const rootAgent = workspaceState.agents.find(
        (agent) =>
          agent.conversationId === conversationId &&
          agentUsesConversationView(agent),
      );
      const token = rootAgent
        ? beginHistoryRefresh(view, rootAgent.id)
        : undefined;
      const baselineCursor = view.cursorSeq;
      const results = await settleConversationRefresh(
        getConversationSnapshotWithCursor(conversationId),
        rootAgent
          ? protocolRequest("agent.promptQueue.list", { agentId: rootAgent.id })
          : Promise.resolve(undefined),
        rootAgent
          ? protocolRequest("agent.history.get", { agentId: rootAgent.id })
          : Promise.resolve(undefined),
      );
      // Navigation can invalidate an in-flight pre-commit read, including its errors.
      if (token !== undefined && view.historyRefreshId !== token) return;
      if (results.snapshot.status === "rejected") {
        view.error =
          results.snapshot.reason instanceof Error
            ? results.snapshot.reason.message
            : String(results.snapshot.reason);
        if (rootAgent && token !== undefined)
          failHistoryRefresh(
            view,
            rootAgent.id,
            token,
            baselineCursor,
            results.snapshot.reason,
          );
        return;
      }
      const response = results.snapshot.value;
      const snapshot = response.snapshot;
      if (!applyCanonicalConversationSnapshot(view, snapshot)) return;
      applyQueueRefresh(
        view,
        results.queue.status === "fulfilled"
          ? {
              status: "fulfilled",
              value: results.queue.value?.result.queuedPrompts,
            }
          : results.queue,
        rootAgent?.id,
      );
      clearContextUsageRefresh(conversationId);
      workspaceState.conversations = workspaceState.conversations.map(
        (candidate) =>
          candidate.id === conversationId ? snapshot.conversation : candidate,
      );
      upsertConversationActivity(snapshot.activity);
      if (rootAgent && token !== undefined) {
        const historyResult =
          results.history.status === "fulfilled"
            ? {
                status: "fulfilled" as const,
                value: results.history.value?.result,
              }
            : results.history;
        if (
          applyRequestedHistoryRefresh(
            view,
            rootAgent,
            token,
            snapshot.cursorSeq,
            historyResult,
            snapshot.tree.navigation.agentId,
          ) &&
          historyResult.status === "fulfilled" &&
          historyResult.value
        ) {
          const history = historyResult.value;
          // Keep canonical transcript/tree display even when owner history is
          // unavailable. Only verified attempt metadata enriches this snapshot.
          view.latestCompletion = history.latestCompletion;
          view.effectiveConfiguration = history.effectiveConfiguration;
          if (history.activity) upsertAgentActivity(history.activity);
        }
      }
      installEventCursors(response.cursor.streams);
      if (
        selection.conversationId === conversationId &&
        (!selectedConversationAgent(conversationId) ||
          agentUsesConversationView(selectedConversationAgent(conversationId)!))
      ) {
        selection.entryId = view.activeEntryId;
      }
    } catch (caught) {
      view.error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      view.loading = false;
    }
  });
}

export function clearConversationState() {
  void voiceInputSession.cancel();
  replaceOpenCenterTabs([]);
  conversationState.activeConversationTabId = undefined;
  setActiveCenterTab(undefined);
  conversationState.conversationViews = {};
  conversationState.agentViews = {};
  conversationState.selectedAgentIds = {};
  conversationState.pendingConversations = {};
  clearActiveSelection();
  persistConversationTabs();
}

export function upsertConversationRecord(
  conversation: ConversationRecord,
): void {
  workspaceState.conversations = [
    conversation,
    ...workspaceState.conversations.filter(
      (candidate) => candidate.id !== conversation.id,
    ),
  ];
}

export function upsertAgentRecord(agent: AgentRecord): void {
  workspaceState.agents = [
    agent,
    ...workspaceState.agents.filter((candidate) => candidate.id !== agent.id),
  ];
}
