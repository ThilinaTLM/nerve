import {
  type AgentRecord,
  apiGet,
  apiPathSegment,
  type ConversationRecord,
  getConversationSnapshot,
  type ProjectRecord,
} from "../../api";
import { voiceInputSession } from "../../audio/voice-input-session.svelte";
import { composerDraft, selection } from "../../state/app-state.svelte";
import { modelKey } from "../../utils/model";
import { replaceOpenCenterTabs } from "../workbench/center-tabs.svelte";
import {
  activeRunToLegacyLive,
  liveTextFromLegacyLive,
} from "../workbench/live";
import { workbenchState } from "../workbench/state.svelte";
import { entriesToTranscript } from "../workbench/transcript";
import {
  clearActiveSelection,
  ensureConversationView,
  persistConversationTabs,
} from "./state";

function agentForConversation(
  conversation: ConversationRecord,
): AgentRecord | undefined {
  return workbenchState.agents.find(
    (agent) =>
      agent.id === conversation.activeAgentId ||
      agent.conversationId === conversation.id,
  );
}

async function projectForConversation(
  conversation: ConversationRecord,
): Promise<ProjectRecord> {
  return (
    workbenchState.projects.find(
      (candidate) => candidate.id === conversation.projectId,
    ) ??
    (
      await apiGet<{ project: ProjectRecord }>(
        `/api/projects/${apiPathSegment(conversation.projectId)}`,
      )
    ).project
  );
}

export async function applyActiveConversationSelection(
  conversation: ConversationRecord,
) {
  selection.conversationId = conversation.id;
  selection.projectId = conversation.projectId;
  const conversationAgent = agentForConversation(conversation);
  selection.agentId = conversation.activeAgentId ?? conversationAgent?.id;
  selection.entryId = conversation.activeEntryId;
  const project = await projectForConversation(conversation);
  composerDraft.projectDir = project.dir;
  if (conversationAgent?.model) {
    workbenchState.selectedModelKey = modelKey(conversationAgent.model);
  }
  workbenchState.selectedThinkingLevel =
    conversationAgent?.thinkingLevel ?? "off";
  workbenchState.selectedMode = conversationAgent?.mode ?? conversation.mode;
  workbenchState.selectedPermissionLevel =
    conversationAgent?.permissionLevel ?? conversation.permissionLevel;
}

export async function refreshConversationView(conversationId: string) {
  const view = ensureConversationView(conversationId);
  view.loading = true;
  try {
    const snapshot = await getConversationSnapshot(conversationId);
    view.activeEntryId = snapshot.tree.activeEntryId;
    view.activeEntryIds = snapshot.activeEntryIds;
    view.transcript = entriesToTranscript(snapshot.entries);
    view.toolCalls = snapshot.toolCalls;
    view.treeNodes = snapshot.tree.nodes;
    view.activeRun = snapshot.activeRun;
    view.queuedPrompts = snapshot.activeRun?.queuedPrompts ?? [];
    view.contextUsage = snapshot.contextUsage;
    view.cursorSeq = snapshot.cursorSeq;
    workbenchState.conversations = workbenchState.conversations.map(
      (candidate) =>
        candidate.id === conversationId ? snapshot.conversation : candidate,
    );
    const persistedLiveMessageIds = new Set(
      snapshot.entries.flatMap((entry) =>
        entry.role === "assistant" && entry.liveMessageId
          ? [entry.liveMessageId]
          : [],
      ),
    );
    view.live = activeRunToLegacyLive(snapshot.activeRun, {
      excludeLiveMessageIds: persistedLiveMessageIds,
    });
    view.streamingText = liveTextFromLegacyLive(view.live);
    view.sending = Boolean(snapshot.activeRun);
    if (selection.conversationId === conversationId) {
      selection.entryId = snapshot.tree.activeEntryId;
      workbenchState.treeNodes = snapshot.tree.nodes;
      workbenchState.transcript = view.transcript;
      workbenchState.streamingText = view.streamingText;
      workbenchState.sending = view.sending;
    }
  } finally {
    view.loading = false;
  }
}

export function clearConversationState() {
  void voiceInputSession.cancel();
  replaceOpenCenterTabs([]);
  workbenchState.activeConversationTabId = undefined;
  workbenchState.activeCenterTab = undefined;
  workbenchState.conversationViews = {};
  workbenchState.pendingConversations = {};
  workbenchState.fileViews = {};
  clearActiveSelection();
  persistConversationTabs();
}

export function upsertConversationRecord(
  conversation: ConversationRecord,
): void {
  workbenchState.conversations = [
    conversation,
    ...workbenchState.conversations.filter(
      (candidate) => candidate.id !== conversation.id,
    ),
  ];
}

export function upsertAgentRecord(agent: AgentRecord): void {
  workbenchState.agents = [
    agent,
    ...workbenchState.agents.filter((candidate) => candidate.id !== agent.id),
  ];
}
