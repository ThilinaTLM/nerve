import { deriveConversationTitle } from "@nerve/shared";
import { notify } from "$lib/notifications/notify.svelte";
import {
  type AgentRecord,
  acceptPlanReview,
  answerUserQuestion,
  apiGet,
  apiPost,
  type ConversationRecord,
  compactConversation,
  deleteConversation,
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
  replaceCenterTab,
  replaceOpenCenterTabs,
  selectCenterTab,
  setActiveCenterTab,
} from "./workbench/center-tabs.svelte";
import {
  filterStoredTabsAgainstConversations,
  loadStoredConversationTabs,
  saveConversationTabs,
} from "./workbench/conversation-tabs";
import {
  activeRunToLegacyLive,
  liveTextFromLegacyLive,
} from "./workbench/live";
import type {
  ConversationViewState,
  PendingConversationState,
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
    queuedPrompts: [],
    cursorSeq: 0,
    sending: false,
    composerText: "",
    loading: false,
  };
  return workbenchState.conversationViews[conversationId];
}

export {
  activeRunToLegacyLive,
  liveTextFromLegacyLive,
} from "./workbench/live";

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

let pendingConversationCounter = 0;

function createPendingConversationId(): string {
  pendingConversationCounter += 1;
  return `pending_${Date.now().toString(36)}_${pendingConversationCounter.toString(36)}`;
}

function activePendingConversation(): PendingConversationState | undefined {
  const active = workbenchState.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return workbenchState.pendingConversations[active.id];
}

function clearTranscriptState() {
  workbenchState.treeNodes = [];
  workbenchState.transcript = [];
  workbenchState.streamingText = "";
  workbenchState.sending = false;
  workbenchState.error = undefined;
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
  clearTranscriptState();
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
    view.queuedPrompts = snapshot.activeRun?.queuedPrompts ?? [];
    view.contextUsage = snapshot.contextUsage;
    view.cursorSeq = snapshot.cursorSeq;
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

export function openPendingConversation(project: ProjectRecord) {
  const id = createPendingConversationId();
  workbenchState.pendingConversations[id] = {
    id,
    projectId: project.id,
    projectDir: project.dir,
    title: "New Conversation",
    composerText: "",
    selectedModelKey: workbenchState.selectedModelKey,
    thinkingLevel: workbenchState.selectedThinkingLevel,
    mode: workbenchState.selectedMode,
    permissionLevel: workbenchState.selectedPermissionLevel,
    sending: false,
    createdAt: new Date().toISOString(),
  };
  addCenterTab({ kind: "pending-conversation", id });
  selectPendingConversation(id);
}

export function selectPendingConversation(pendingId: string) {
  const pending = workbenchState.pendingConversations[pendingId];
  if (!pending) return;
  setActiveCenterTab({ kind: "pending-conversation", id: pending.id });
  workbenchState.activeConversationTabId = undefined;
  resetSelection();
  selection.projectId = pending.projectId;
  composerDraft.projectDir = pending.projectDir;
  workbenchState.selectedModelKey = pending.selectedModelKey;
  workbenchState.selectedThinkingLevel = pending.thinkingLevel;
  workbenchState.selectedMode = pending.mode;
  workbenchState.selectedPermissionLevel = pending.permissionLevel;
  clearTranscriptState();
  workbenchState.sending = pending.sending;
  workbenchState.error = pending.error;
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
  const pending = activePendingConversation();
  if (pending) {
    pending.composerText = value;
    return;
  }
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

export async function closePendingConversationTab(pendingId: string) {
  const pending = workbenchState.pendingConversations[pendingId];
  if (!pending) return;
  const tab = { kind: "pending-conversation" as const, id: pendingId };
  const fallback = nextCenterTabAfterClose(tab);
  const closingActiveCenter =
    workbenchState.activeCenterTab?.kind === "pending-conversation" &&
    workbenchState.activeCenterTab.id === pendingId;
  removeCenterTab(tab);
  delete workbenchState.pendingConversations[pendingId];
  if (closingActiveCenter) {
    clearActiveSelection();
    await selectCenterTab(fallback);
  }
  persistConversationTabs();
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
  workbenchState.pendingConversations = {};
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
  notify.success("Approval granted");
}

export async function denyApproval(approvalId: string) {
  await apiPost(`/api/approvals/${approvalId}/deny`, {
    note: "Denied from UI.",
  });
  workbenchState.approvals = await getPendingApprovals();
  notify.message("Approval denied");
}

export async function acceptPendingPlanReview(reviewId: string) {
  await acceptPlanReview(reviewId);
  workbenchState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  if (selection.conversationId)
    await refreshConversationView(selection.conversationId);
  notify.success("Plan accepted");
}

export async function rejectPendingPlanReview(reviewId: string) {
  await rejectPlanReview(reviewId, "Rejected from UI.");
  workbenchState.planReviews = await getPendingPlanReviews();
  await loadWorkspaceState();
  if (selection.conversationId)
    await refreshConversationView(selection.conversationId);
  notify.message("Plan rejected");
}

export async function requestPendingPlanChanges(
  reviewId: string,
  feedback: string,
) {
  await requestPlanChanges(reviewId, feedback);
  workbenchState.planReviews = await getPendingPlanReviews();
  notify.message("Change request sent");
}

export async function discardPendingPlanReview(reviewId: string) {
  await discardPlanReview(reviewId, "Discarded from UI.");
  workbenchState.planReviews = await getPendingPlanReviews();
  notify.message("Plan discarded");
}

export async function answerUserQuestionById(
  questionId: string,
  answer: string,
) {
  const trimmed = answer.trim();
  if (!trimmed) return;
  await answerUserQuestion(questionId, trimmed);
  workbenchState.userQuestions = await getPendingUserQuestions();
  notify.success("Reply sent");
}

export async function dismissUserQuestionById(questionId: string) {
  await dismissUserQuestionRequest(questionId, "Dismissed from UI.");
  workbenchState.userQuestions = await getPendingUserQuestions();
  notify.message("Question dismissed");
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
    view.queuedPrompts = [];
  }
  workbenchState.sending = false;
  workbenchState.streamingText = "";
}

function hasUsableModel(): boolean {
  return (
    scopedUsableModelOptions(
      workbenchState.models,
      workbenchState.authProviders,
      workbenchState.settingsDraft?.scopedModels,
    ).length > 0
  );
}

function notifyPromptError(title: string, message: string): void {
  notify.error(title, { description: message });
}

function upsertConversationRecord(conversation: ConversationRecord): void {
  workbenchState.conversations = [
    conversation,
    ...workbenchState.conversations.filter(
      (candidate) => candidate.id !== conversation.id,
    ),
  ];
}

function upsertAgentRecord(agent: AgentRecord): void {
  workbenchState.agents = [
    agent,
    ...workbenchState.agents.filter((candidate) => candidate.id !== agent.id),
  ];
}

type SendPromptTextOptions = {
  clearComposer?: boolean;
};

async function sendPendingPrompt(
  pending: PendingConversationState,
  text: string,
  options: SendPromptTextOptions = {},
): Promise<void> {
  const clearComposer = options.clearComposer ?? true;

  if (!hasUsableModel()) {
    void openSettingsPane();
    const message =
      "Configure a model provider or adjust Scoped Models in Settings before prompting.";
    pending.error = message;
    workbenchState.error = message;
    notifyPromptError("No usable model configured", message);
    return;
  }

  pending.selectedModelKey = workbenchState.selectedModelKey;
  pending.thinkingLevel = selectedThinkingLevel();
  pending.mode = workbenchState.selectedMode;
  pending.permissionLevel = workbenchState.selectedPermissionLevel;
  pending.sending = true;
  pending.error = undefined;
  workbenchState.sending = true;
  workbenchState.error = undefined;
  workbenchState.streamingText = "";

  let view: ConversationViewState | undefined;
  let createdConversationId: string | undefined;
  try {
    const { conversation } = await apiPost<{
      conversation: ConversationRecord;
    }>("/api/conversations", {
      projectId: pending.projectId,
      title: deriveConversationTitle(text),
      mode: pending.mode,
      permissionLevel: pending.permissionLevel,
    });
    createdConversationId = conversation.id;
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: pending.projectId,
      conversationId: conversation.id,
      model: selectedModel(),
      thinkingLevel: pending.thinkingLevel,
      mode: pending.mode,
      permissionLevel: pending.permissionLevel,
    });

    upsertConversationRecord(conversation);
    upsertAgentRecord(agent);
    replaceCenterTab(
      { kind: "pending-conversation", id: pending.id },
      { kind: "conversation", id: conversation.id },
    );
    workbenchState.activeConversationTabId = conversation.id;
    selection.projectId = conversation.projectId;
    selection.conversationId = conversation.id;
    selection.entryId = conversation.activeEntryId;
    selection.agentId = agent.id;
    composerDraft.projectDir = pending.projectDir;
    const preservedComposerText = clearComposer ? "" : pending.composerText;
    delete workbenchState.pendingConversations[pending.id];
    view = ensureConversationView(conversation.id);
    view.sending = true;
    view.error = undefined;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
    view.transcript = [{ role: "user", text, optimistic: true }];
    view.composerText = preservedComposerText;
    workbenchState.transcript = view.transcript;
    workbenchState.treeNodes = [];
    workbenchState.streamingText = "";
    workbenchState.error = undefined;
    if (clearComposer) composerDraft.text = "";
    persistConversationTabs();
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await apiPost(`/api/agents/${agent.id}/prompt`, { text });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    if (view) {
      view.error = message;
      view.sending = false;
    } else {
      if (createdConversationId)
        await deleteConversation(createdConversationId).catch(() => undefined);
      pending.error = message;
      pending.sending = false;
    }
    workbenchState.error = message;
    workbenchState.sending = false;
    notifyPromptError("Prompt failed", message);
  }
}

export async function sendPromptText(
  rawText: string,
  options: SendPromptTextOptions = {},
) {
  const clearComposer = options.clearComposer ?? true;
  const pending = activePendingConversation();
  const view = selection.conversationId
    ? ensureConversationView(selection.conversationId)
    : undefined;
  const text = rawText.trim();
  if (!text || pending?.sending) return;
  if (pending) {
    await sendPendingPrompt(pending, text, { clearComposer });
    return;
  }
  if (!selection.projectId || !selection.conversationId || !view) {
    workbenchState.projectPickerOpen = true;
    const message =
      "Select a project directory before starting a conversation.";
    workbenchState.error = message;
    notifyPromptError("Select a project directory", message);
    return;
  }
  if (!hasUsableModel()) {
    void openSettingsPane();
    const message =
      "Configure a model provider or adjust Scoped Models in Settings before prompting.";
    view.error = message;
    workbenchState.error = message;
    notifyPromptError("No usable model configured", message);
    return;
  }
  const queueWhileRunning = Boolean(view.sending || workbenchState.sending);
  view.error = undefined;
  workbenchState.error = undefined;
  if (!queueWhileRunning) {
    view.sending = true;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
    workbenchState.sending = true;
    workbenchState.streamingText = "";
  }
  try {
    const agentId = await ensureAgent();
    if (clearComposer) {
      view.composerText = "";
      composerDraft.text = "";
    }
    if (queueWhileRunning) {
      await apiPost(`/api/agents/${agentId}/prompt`, {
        text,
        behavior: "steer",
      });
      return;
    }
    view.transcript = [
      ...view.transcript,
      { role: "user", text, optimistic: true },
    ];
    workbenchState.transcript = view.transcript;
    await apiPost(`/api/agents/${agentId}/prompt`, { text });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    workbenchState.error = message;
    if (!queueWhileRunning) {
      view.sending = false;
      workbenchState.sending = false;
    }
    notifyPromptError("Prompt failed", message);
  }
}

export async function sendPrompt() {
  const pending = activePendingConversation();
  const view = selection.conversationId
    ? ensureConversationView(selection.conversationId)
    : undefined;
  const text = (
    pending?.composerText ??
    view?.composerText ??
    composerDraft.text
  ).trim();
  if (!text || pending?.sending) return;
  if (text === "/abort") {
    if (pending) pending.composerText = "";
    if (view) view.composerText = "";
    composerDraft.text = "";
    await abortActiveRun();
    return;
  }
  await sendPromptText(text, { clearComposer: true });
}
