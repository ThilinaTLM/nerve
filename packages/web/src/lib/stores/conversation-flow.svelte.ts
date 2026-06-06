import { toast } from "svelte-sonner";
import {
  type AgentRecord,
  acceptPlanReview,
  answerUserQuestion,
  apiGet,
  apiPost,
  type ConversationActiveRunSnapshot,
  type ConversationRecord,
  compactConversation,
  discardPlanReview,
  dismissUserQuestion as dismissUserQuestionRequest,
  getConversationSnapshot,
  getPendingApprovals,
  getPendingPlanReviews,
  getPendingUserQuestions,
  type ProjectRecord,
  rejectPlanReview,
  requestPlanChanges,
  updateAgentConfig,
} from "../api";
import { queryClient, queryKeys } from "../query";
import {
  composerDraft,
  resetSelection,
  selection,
} from "../state/app-state.svelte";
import { modelKey, scopedUsableModelOptions } from "../utils/model";
import {
  agentNeedsComposerUpdate,
  currentActiveAgent,
  selectedModel,
  selectedThinkingLevel,
} from "./composer-config.svelte";
import { openSettingsPane } from "./settings.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  replaceOpenCenterTabs,
  selectCenterTab,
  setActiveCenterTab,
} from "./workbench/center-tabs.svelte";
import {
  filterStoredTabsAgainstConversations,
  loadStoredConversationTabs,
  saveConversationTabs,
} from "./workbench/conversation-tabs";
import type {
  ConversationLiveState,
  ConversationViewState,
} from "./workbench/state.svelte";
import { workbenchState } from "./workbench/state.svelte";
import { entriesToTranscript } from "./workbench/transcript";
import { loadWorkspaceState } from "./workspace.svelte";

export function ensureConversationView(
  conversationId: string,
): ConversationViewState {
  workbenchState.conversationViews[conversationId] ??= {
    conversationId,
    transcript: [],
    toolCalls: [],
    treeNodes: [],
    streamingText: "",
    live: { messages: [], toolDrafts: [], toolOutputByToolCallId: {} },
    cursorSeq: 0,
    sending: false,
    composerText: "",
    loading: false,
  };
  return workbenchState.conversationViews[conversationId];
}

export function activeRunToLegacyLive(
  activeRun: ConversationActiveRunSnapshot | undefined,
): ConversationLiveState {
  if (!activeRun) {
    return { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
  }
  const messages = activeRun.turns.flatMap((turn) =>
    turn.messages.flatMap((message) =>
      message.blocks.flatMap((block) => {
        if (block.kind === "tool_call_draft") return [];
        return [
          {
            id: `live:${message.liveMessageId}:${block.kind}:${block.contentIndex}`,
            role: "assistant" as const,
            displayKind:
              block.kind === "thinking"
                ? ("thinking" as const)
                : ("message" as const),
            text: block.text,
            createdAt: message.startedAt,
            contentIndex: block.contentIndex,
            live: !block.done,
            done: block.done,
            redacted: block.redacted,
          },
        ];
      }),
    ),
  );
  const toolDrafts = activeRun.turns.flatMap((turn) =>
    turn.messages.flatMap((message) =>
      message.blocks.flatMap((block) => {
        if (block.kind !== "tool_call_draft") return [];
        return [
          {
            kind: "tool_call_draft" as const,
            key: `live:${message.liveMessageId}:tool-draft:${block.contentIndex}`,
            runId: activeRun.runId,
            conversationId: activeRun.conversationId,
            contentIndex: block.contentIndex,
            providerToolCallId: block.providerToolCallId,
            toolName: block.toolName,
            argsText: block.argsText,
            args: block.args,
            done: block.done,
            createdAt: message.startedAt,
            updatedAt: message.startedAt,
          },
        ];
      }),
    ),
  );
  return {
    runId: activeRun.runId,
    messages,
    toolDrafts,
    toolOutputByToolCallId: activeRun.toolOutputsByToolCallId,
  };
}

export function liveTextFromLegacyLive(live: ConversationLiveState): string {
  return live.messages
    .filter((item) => item.displayKind !== "thinking")
    .sort((a, b) => (a.contentIndex ?? 0) - (b.contentIndex ?? 0))
    .map((item) => item.text)
    .join("\n");
}

function persistConversationTabs() {
  saveConversationTabs(
    workbenchState.openConversationTabIds,
    workbenchState.activeConversationTabId,
  );
}

function addConversationTab(conversationId: string) {
  addCenterTab({ kind: "conversation", id: conversationId });
  ensureConversationView(conversationId);
}

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
        `/api/projects/${conversation.projectId}`,
      )
    ).project
  );
}

async function applyActiveConversationSelection(
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

function clearActiveSelection() {
  resetSelection();
  workbenchState.activeConversationTabId = undefined;
  workbenchState.treeNodes = [];
  workbenchState.transcript = [];
  workbenchState.streamingText = "";
  workbenchState.sending = false;
  workbenchState.error = undefined;
  composerDraft.text = "";
}

export async function refreshConversationView(conversationId: string) {
  const view = ensureConversationView(conversationId);
  view.loading = true;
  try {
    const snapshot = await getConversationSnapshot(conversationId);
    view.transcript = entriesToTranscript(snapshot.entries);
    view.toolCalls = snapshot.toolCalls;
    view.treeNodes = snapshot.tree.nodes;
    view.activeRun = snapshot.activeRun;
    view.contextUsage = snapshot.contextUsage;
    view.cursorSeq = snapshot.cursorSeq;
    view.live = activeRunToLegacyLive(snapshot.activeRun);
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

export async function openConversation(conversationId: string) {
  const conversation =
    workbenchState.conversations.find(
      (candidate) => candidate.id === conversationId,
    ) ??
    (
      await apiGet<{ conversation: ConversationRecord }>(
        `/api/conversations/${conversationId}`,
      )
    ).conversation;
  addConversationTab(conversation.id);
  workbenchState.activeConversationTabId = conversation.id;
  setActiveCenterTab({ kind: "conversation", id: conversation.id });
  persistConversationTabs();
  await applyActiveConversationSelection(conversation);
  await refreshConversationView(conversation.id);
  const view = ensureConversationView(conversation.id);
  workbenchState.streamingText = view.streamingText;
  workbenchState.sending = view.sending;
  workbenchState.error = view.error;
}

export async function restoreConversationTabs() {
  const stored = loadStoredConversationTabs();
  const tabIds = filterStoredTabsAgainstConversations(
    stored.tabIds,
    workbenchState.conversations,
  );
  replaceOpenCenterTabs(tabIds.map((id) => ({ kind: "conversation", id })));
  for (const conversationId of tabIds) ensureConversationView(conversationId);
  const activeId =
    stored.activeId && tabIds.includes(stored.activeId)
      ? stored.activeId
      : tabIds[0];
  workbenchState.activeConversationTabId = activeId;
  persistConversationTabs();
  if (activeId) await openConversation(activeId);
}

export function setActiveComposerText(value: string) {
  if (!selection.conversationId) {
    composerDraft.text = value;
    return;
  }
  ensureConversationView(selection.conversationId).composerText = value;
}

export async function closeConversationTab(conversationId: string) {
  const currentIds = workbenchState.openConversationTabIds;
  const closingIndex = currentIds.indexOf(conversationId);
  if (closingIndex === -1) return;
  const tab = { kind: "conversation" as const, id: conversationId };
  const fallback = nextCenterTabAfterClose(tab);
  const nextIds = currentIds.filter((id) => id !== conversationId);
  const nextConversationId = nextIds[closingIndex] ?? nextIds[closingIndex - 1];
  removeCenterTab(tab);
  delete workbenchState.conversationViews[conversationId];

  const closingActiveCenter =
    workbenchState.activeCenterTab?.kind === "conversation" &&
    workbenchState.activeCenterTab.id === conversationId;

  if (workbenchState.activeConversationTabId === conversationId) {
    workbenchState.activeConversationTabId = nextConversationId;
  }

  if (selection.conversationId === conversationId && !nextConversationId) {
    clearActiveSelection();
  }

  persistConversationTabs();

  if (closingActiveCenter) {
    await selectCenterTab(fallback);
  }
}

export async function removeConversationTabs(conversationIds: string[]) {
  const removing = new Set(conversationIds);
  const activeRemoved = selection.conversationId
    ? removing.has(selection.conversationId)
    : false;
  replaceOpenCenterTabs(
    workbenchState.openCenterTabs.filter(
      (tab) => tab.kind !== "conversation" || !removing.has(tab.id),
    ),
  );
  for (const conversationId of removing)
    delete workbenchState.conversationViews[conversationId];

  if (!activeRemoved) {
    persistConversationTabs();
    return;
  }

  const nextConversationId = workbenchState.openConversationTabIds[0];
  if (nextConversationId) {
    workbenchState.activeConversationTabId = nextConversationId;
    persistConversationTabs();
    await openConversation(nextConversationId);
    return;
  }

  clearActiveSelection();
  await selectCenterTab(workbenchState.openCenterTabs[0]);
  persistConversationTabs();
}

export async function navigateToEntry(
  entryId: string | undefined,
  summarize = false,
) {
  if (!selection.conversationId) return;
  const conversationId = selection.conversationId;
  await apiPost(`/api/conversations/${conversationId}/navigate`, {
    activeEntryId: entryId ?? null,
    summarize,
  });
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openConversation(conversationId);
}

export async function compactActiveConversation() {
  if (!selection.conversationId) return;
  const conversationId = selection.conversationId;
  await compactConversation(conversationId);
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openConversation(conversationId);
}

export function clearConversationState() {
  replaceOpenCenterTabs([]);
  workbenchState.activeConversationTabId = undefined;
  workbenchState.activeCenterTab = undefined;
  workbenchState.conversationViews = {};
  workbenchState.fileViews = {};
  clearActiveSelection();
  persistConversationTabs();
}

export async function ensureAgent(): Promise<string> {
  if (selection.agentId) {
    const agent = currentActiveAgent();
    const {
      desired,
      thinkingLevel,
      needsModel,
      needsMode,
      needsPermission,
      needsThinking,
    } = agentNeedsComposerUpdate(agent);
    if (needsModel || needsMode || needsPermission || needsThinking) {
      const updated = await updateAgentConfig(selection.agentId, {
        model: desired ?? null,
        thinkingLevel,
        mode: workbenchState.selectedMode,
        permissionLevel: workbenchState.selectedPermissionLevel,
      }).catch(() => undefined);
      if (updated) {
        workbenchState.selectedThinkingLevel = updated.thinkingLevel;
        workbenchState.agents = workbenchState.agents.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        );
      }
    }
    return selection.agentId;
  }
  if (selection.projectId && selection.conversationId) {
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: selection.projectId,
      conversationId: selection.conversationId,
      model: selectedModel(),
      thinkingLevel: selectedThinkingLevel(),
      mode: workbenchState.selectedMode,
      permissionLevel: workbenchState.selectedPermissionLevel,
    });
    selection.agentId = agent.id;
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    return agent.id;
  }
  workbenchState.projectPickerOpen = true;
  throw new Error("Select a project directory before starting a conversation.");
}

export async function grantApproval(approvalId: string) {
  await apiPost(`/api/approvals/${approvalId}/grant`, {});
  workbenchState.approvals = await getPendingApprovals();
  toast.success("Approval granted");
}

export async function denyApproval(approvalId: string) {
  await apiPost(`/api/approvals/${approvalId}/deny`, {
    note: "Denied from UI.",
  });
  workbenchState.approvals = await getPendingApprovals();
  toast.message("Approval denied");
}

export async function acceptPendingPlanReview(reviewId: string) {
  await acceptPlanReview(reviewId);
  workbenchState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  if (selection.conversationId)
    await refreshConversationView(selection.conversationId);
  toast.success("Plan accepted");
}

export async function rejectPendingPlanReview(reviewId: string) {
  await rejectPlanReview(reviewId, "Rejected from UI.");
  workbenchState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  if (selection.conversationId)
    await refreshConversationView(selection.conversationId);
  toast.message("Plan rejected");
}

export async function requestPendingPlanChanges(
  reviewId: string,
  feedback: string,
) {
  await requestPlanChanges(reviewId, feedback);
  workbenchState.planReviews = await getPendingPlanReviews();
  toast.message("Change request sent");
}

export async function discardPendingPlanReview(reviewId: string) {
  await discardPlanReview(reviewId, "Discarded from UI.");
  workbenchState.planReviews = await getPendingPlanReviews();
  toast.message("Plan discarded");
}

export async function answerUserQuestionById(
  questionId: string,
  answer: string,
) {
  const trimmed = answer.trim();
  if (!trimmed) return;
  await answerUserQuestion(questionId, trimmed);
  workbenchState.userQuestions = await getPendingUserQuestions();
  toast.success("Reply sent");
}

export async function dismissUserQuestionById(questionId: string) {
  await dismissUserQuestionRequest(questionId, "Dismissed from UI.");
  workbenchState.userQuestions = await getPendingUserQuestions();
  toast.message("Question dismissed");
}

export async function abortActiveRun() {
  if (!selection.agentId) return;
  const view = selection.conversationId
    ? ensureConversationView(selection.conversationId)
    : undefined;
  await apiPost(`/api/agents/${selection.agentId}/abort`, {});
  if (view) {
    view.sending = false;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
  }
  workbenchState.sending = false;
  workbenchState.streamingText = "";
}

export async function sendPrompt() {
  const view = selection.conversationId
    ? ensureConversationView(selection.conversationId)
    : undefined;
  const text = (view?.composerText ?? composerDraft.text).trim();
  if (!text || view?.sending || workbenchState.sending) return;
  if (text === "/abort") {
    if (view) view.composerText = "";
    composerDraft.text = "";
    await abortActiveRun();
    return;
  }
  if (!selection.projectId || !selection.conversationId || !view) {
    workbenchState.projectPickerOpen = true;
    workbenchState.error =
      "Select a project directory before starting a conversation.";
    return;
  }
  if (
    scopedUsableModelOptions(
      workbenchState.models,
      workbenchState.authProviders,
      workbenchState.settingsDraft?.scopedModels,
    ).length === 0
  ) {
    void openSettingsPane();
    view.error =
      "Configure a model provider or adjust Scoped Models in Settings before prompting.";
    workbenchState.error = view.error;
    return;
  }
  view.sending = true;
  view.error = undefined;
  view.streamingText = "";
  view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
  workbenchState.sending = true;
  workbenchState.error = undefined;
  workbenchState.streamingText = "";
  try {
    const agentId = await ensureAgent();
    view.transcript = [
      ...view.transcript,
      { role: "user", text, optimistic: true },
    ];
    workbenchState.transcript = view.transcript;
    view.composerText = "";
    composerDraft.text = "";
    await apiPost(`/api/agents/${agentId}/prompt`, { text });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    workbenchState.error = message;
    view.sending = false;
    workbenchState.sending = false;
  }
}
