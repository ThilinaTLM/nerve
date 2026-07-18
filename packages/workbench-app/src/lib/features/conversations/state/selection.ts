import { modelKey } from "@nervekit/workbench-ui/core/utils/model";
import { fromConversationSnapshot } from "@nervekit/workbench-ui/state";
import {
  type AgentRecord,
  type ConversationRecord,
  getConversationSnapshotWithCursor,
  getProject,
  type ProjectRecord,
} from "$lib/api";
import { voiceInputSession } from "$lib/core/audio/voice-input-session.svelte";
import { installEventCursors } from "$lib/core/events/stream-cursors.svelte";
import { agentConfigOverride } from "$lib/features/conversations/state/agent-config-mutations.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { stoppingAfterConversationSnapshot } from "$lib/features/conversations/state/conversation-terminal-state";
import { fileState } from "$lib/features/filesystem/state/file-state.svelte";
import { replaceOpenCenterTabs } from "$lib/features/workspace/state/center-tabs.svelte";
import {
  composerDraft,
  selection,
} from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  clearActiveSelection,
  ensureConversationView,
  persistConversationTabs,
} from "./state";

function agentForConversation(
  conversation: ConversationRecord,
): AgentRecord | undefined {
  return workspaceState.agents.find(
    (agent) =>
      agent.id === conversation.activeAgentId ||
      agent.conversationId === conversation.id,
  );
}

async function projectForConversation(
  conversation: ConversationRecord,
): Promise<ProjectRecord> {
  return (
    workspaceState.projects.find(
      (candidate) => candidate.id === conversation.projectId,
    ) ?? (await getProject(conversation.projectId))
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
  // A pending desired override survives tab switches: it stays the display
  // value for its agent until the in-flight configuration mutation settles.
  const override = agentConfigOverride(conversationAgent?.id);
  const overrideModel = override?.model ?? undefined;
  if (overrideModel) {
    conversationState.selectedModelKey = modelKey(overrideModel);
  } else if (conversationAgent?.model) {
    conversationState.selectedModelKey = modelKey(conversationAgent.model);
  }
  conversationState.selectedThinkingLevel =
    override?.thinkingLevel ?? conversationAgent?.thinkingLevel ?? "off";
  conversationState.selectedMode =
    override?.mode ?? conversationAgent?.mode ?? conversation.mode;
  conversationState.selectedPermissionLevel =
    override?.permissionLevel ??
    conversationAgent?.permissionLevel ??
    conversation.permissionLevel;
  conversationState.selectedApprovalPolicy =
    override?.approvalPolicy ??
    conversationAgent?.approvalPolicy ??
    conversation.approvalPolicy;
}

export async function refreshConversationView(conversationId: string) {
  const view = ensureConversationView(conversationId);
  view.loading = true;
  try {
    const response = await getConversationSnapshotWithCursor(conversationId);
    const snapshot = response.snapshot;
    // Canonical state comes straight from the shared snapshot ingestion
    // (which drains already-materialized active-run messages).
    const canonical = fromConversationSnapshot(snapshot);
    const previousRunId = view.activeRun?.runId;
    view.activeEntryId = snapshot.tree.activeEntryId;
    view.activeEntryIds = canonical.activeEntryIds;
    view.entries = canonical.entries;
    view.toolCalls = canonical.toolCalls;
    view.treeNodes = snapshot.tree.nodes;
    view.activeRun = canonical.activeRun;
    view.transient = undefined;
    view.optimisticMessages = [];
    view.queuedPrompts = canonical.queuedPrompts ?? [];
    view.contextUsage = canonical.contextUsage;
    view.cursorSeq = canonical.cursorSeq;
    view.stopping = stoppingAfterConversationSnapshot(
      view.stopping,
      previousRunId,
      canonical.activeRun?.runId,
    );
    workspaceState.conversations = workspaceState.conversations.map(
      (candidate) =>
        candidate.id === conversationId ? snapshot.conversation : candidate,
    );
    view.sending = Boolean(snapshot.activeRun);
    installEventCursors(response.cursor.streams);
    if (selection.conversationId === conversationId) {
      selection.entryId = snapshot.tree.activeEntryId;
    }
  } finally {
    view.loading = false;
  }
}

export function clearConversationState() {
  void voiceInputSession.cancel();
  replaceOpenCenterTabs([]);
  conversationState.activeConversationTabId = undefined;
  workspaceState.activeCenterTab = undefined;
  conversationState.conversationViews = {};
  conversationState.pendingConversations = {};
  fileState.fileViews = {};
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
