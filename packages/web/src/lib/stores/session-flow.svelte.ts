import { toast } from "svelte-sonner";
import {
  type AgentRecord,
  type ConversationActiveRunSnapshot,
  acceptPlanReview,
  answerUserQuestion,
  apiGet,
  apiPost,
  compactSession,
  discardPlanReview,
  dismissUserQuestion as dismissUserQuestionRequest,
  getPendingApprovals,
  getPendingPlanReviews,
  getPendingUserQuestions,
  getConversationSnapshot,
  getProcessLogs,
  type ProjectRecord,
  requestPlanChanges,
  type SessionRecord,
  updateAgentConfig,
} from "../api";
import { queryClient, queryKeys } from "../query";
import {
  composerDraft,
  resetSelection,
  selection,
} from "../state/app-state.svelte";
import { modelKey, usableModelOptions } from "../utils/model";
import {
  agentNeedsComposerUpdate,
  currentActiveAgent,
  selectedModel,
  selectedThinkingLevel,
} from "./composer-config.svelte";
import { openSettingsPane } from "./settings.svelte";
import {
  filterStoredTabsAgainstSessions,
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
  sessionId: string,
): ConversationViewState {
  workbenchState.conversationViews[sessionId] ??= {
    sessionId,
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
  return workbenchState.conversationViews[sessionId];
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
            displayKind: block.kind === "thinking" ? "thinking" as const : "message" as const,
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
            sessionId: activeRun.sessionId,
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

function addConversationTab(sessionId: string) {
  if (!workbenchState.openConversationTabIds.includes(sessionId)) {
    workbenchState.openConversationTabIds = [
      ...workbenchState.openConversationTabIds,
      sessionId,
    ];
  }
  ensureConversationView(sessionId);
}

function agentForSession(session: SessionRecord): AgentRecord | undefined {
  return workbenchState.agents.find(
    (agent) =>
      agent.id === session.activeAgentId || agent.sessionId === session.id,
  );
}

async function projectForSession(
  session: SessionRecord,
): Promise<ProjectRecord> {
  return (
    workbenchState.projects.find(
      (candidate) => candidate.id === session.projectId,
    ) ??
    (
      await apiGet<{ project: ProjectRecord }>(
        `/api/projects/${session.projectId}`,
      )
    ).project
  );
}

async function applyActiveSessionSelection(session: SessionRecord) {
  selection.sessionId = session.id;
  selection.projectId = session.projectId;
  const sessionAgent = agentForSession(session);
  selection.agentId = session.activeAgentId ?? sessionAgent?.id;
  selection.entryId = session.activeEntryId;
  const project = await projectForSession(session);
  composerDraft.projectDir = project.dir;
  if (sessionAgent?.model) {
    workbenchState.selectedModelKey = modelKey(sessionAgent.model);
  }
  workbenchState.selectedThinkingLevel = sessionAgent?.thinkingLevel ?? "off";
  workbenchState.selectedMode = sessionAgent?.mode ?? session.mode;
  workbenchState.selectedPermissionLevel =
    sessionAgent?.permissionLevel ?? session.permissionLevel;
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

export async function refreshSessionView(sessionId: string) {
  const view = ensureConversationView(sessionId);
  view.loading = true;
  try {
    const snapshot = await getConversationSnapshot(sessionId);
    view.transcript = entriesToTranscript(snapshot.entries);
    view.toolCalls = snapshot.toolCalls;
    view.treeNodes = snapshot.tree.nodes;
    view.activeRun = snapshot.activeRun;
    view.cursorSeq = snapshot.cursorSeq;
    view.live = activeRunToLegacyLive(snapshot.activeRun);
    view.streamingText = liveTextFromLegacyLive(view.live);
    view.sending = Boolean(snapshot.activeRun);
    if (selection.sessionId === sessionId) {
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

export async function openSession(sessionId: string) {
  const session =
    workbenchState.sessions.find((candidate) => candidate.id === sessionId) ??
    (await apiGet<{ session: SessionRecord }>(`/api/sessions/${sessionId}`))
      .session;
  addConversationTab(session.id);
  workbenchState.activeConversationTabId = session.id;
  workbenchState.activeCenterTab = { kind: "conversation", id: session.id };
  persistConversationTabs();
  await applyActiveSessionSelection(session);
  await refreshSessionView(session.id);
  const view = ensureConversationView(session.id);
  workbenchState.streamingText = view.streamingText;
  workbenchState.sending = view.sending;
  workbenchState.error = view.error;
}

export async function restoreConversationTabs() {
  const stored = loadStoredConversationTabs();
  const tabIds = filterStoredTabsAgainstSessions(
    stored.tabIds,
    workbenchState.sessions,
  );
  workbenchState.openConversationTabIds = tabIds;
  for (const sessionId of tabIds) ensureConversationView(sessionId);
  const activeId =
    stored.activeId && tabIds.includes(stored.activeId)
      ? stored.activeId
      : tabIds[0];
  workbenchState.activeConversationTabId = activeId;
  persistConversationTabs();
  if (activeId) await openSession(activeId);
}

export function setActiveComposerText(value: string) {
  if (!selection.sessionId) {
    composerDraft.text = value;
    return;
  }
  ensureConversationView(selection.sessionId).composerText = value;
}

export async function closeConversationTab(sessionId: string) {
  const currentIds = workbenchState.openConversationTabIds;
  const closingIndex = currentIds.indexOf(sessionId);
  if (closingIndex === -1) return;
  const nextIds = currentIds.filter((id) => id !== sessionId);
  workbenchState.openConversationTabIds = nextIds;
  delete workbenchState.conversationViews[sessionId];

  const closingActiveCenter =
    workbenchState.activeCenterTab?.kind === "conversation" &&
    workbenchState.activeCenterTab.id === sessionId;

  if (selection.sessionId !== sessionId) {
    if (closingActiveCenter && nextIds[0]) {
      await openSession(nextIds[0]);
      return;
    }
    persistConversationTabs();
    return;
  }

  const nextSessionId = nextIds[closingIndex] ?? nextIds[closingIndex - 1];
  if (nextSessionId) {
    workbenchState.activeConversationTabId = nextSessionId;
    persistConversationTabs();
    if (closingActiveCenter) await openSession(nextSessionId);
    return;
  }

  clearActiveSelection();
  if (closingActiveCenter && workbenchState.openProcessTabIds[0]) {
    const processId = workbenchState.openProcessTabIds[0];
    workbenchState.activeCenterTab = { kind: "process", id: processId };
    workbenchState.selectedProcessId = processId;
    workbenchState.processLogs = await getProcessLogs(processId);
  } else if (closingActiveCenter && workbenchState.openFileTabIds[0]) {
    workbenchState.activeCenterTab = {
      kind: "file",
      id: workbenchState.openFileTabIds[0],
    };
  } else if (closingActiveCenter && workbenchState.settingsTabOpen) {
    workbenchState.activeCenterTab = { kind: "settings", id: "settings" };
  } else if (closingActiveCenter) {
    workbenchState.activeCenterTab = undefined;
  }
  persistConversationTabs();
}

export async function removeConversationTabs(sessionIds: string[]) {
  const removing = new Set(sessionIds);
  const activeRemoved = selection.sessionId
    ? removing.has(selection.sessionId)
    : false;
  workbenchState.openConversationTabIds =
    workbenchState.openConversationTabIds.filter((id) => !removing.has(id));
  for (const sessionId of removing)
    delete workbenchState.conversationViews[sessionId];

  if (!activeRemoved) {
    persistConversationTabs();
    return;
  }

  const nextSessionId = workbenchState.openConversationTabIds[0];
  if (nextSessionId) {
    workbenchState.activeConversationTabId = nextSessionId;
    persistConversationTabs();
    await openSession(nextSessionId);
    return;
  }

  clearActiveSelection();
  if (workbenchState.openProcessTabIds[0]) {
    const processId = workbenchState.openProcessTabIds[0];
    workbenchState.activeCenterTab = { kind: "process", id: processId };
    workbenchState.selectedProcessId = processId;
    workbenchState.processLogs = await getProcessLogs(processId);
  } else if (workbenchState.openFileTabIds[0]) {
    workbenchState.activeCenterTab = {
      kind: "file",
      id: workbenchState.openFileTabIds[0],
    };
  } else if (workbenchState.settingsTabOpen) {
    workbenchState.activeCenterTab = { kind: "settings", id: "settings" };
  } else {
    workbenchState.activeCenterTab = undefined;
  }
  persistConversationTabs();
}

export async function navigateToEntry(
  entryId: string | undefined,
  summarize = false,
) {
  if (!selection.sessionId) return;
  const sessionId = selection.sessionId;
  await apiPost(`/api/sessions/${sessionId}/navigate`, {
    activeEntryId: entryId ?? null,
    summarize,
  });
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openSession(sessionId);
}

export async function compactActiveSession() {
  if (!selection.sessionId) return;
  const sessionId = selection.sessionId;
  await compactSession(sessionId);
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openSession(sessionId);
}

export function clearConversationState() {
  workbenchState.openConversationTabIds = [];
  workbenchState.openProcessTabIds = [];
  workbenchState.openFileTabIds = [];
  workbenchState.settingsTabOpen = false;
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
  if (selection.projectId && selection.sessionId) {
    const { agent } = await apiPost<{ agent: AgentRecord }>("/api/agents", {
      projectId: selection.projectId,
      sessionId: selection.sessionId,
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
  toast.success("Plan accepted");
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

export async function answerActiveUserQuestion() {
  const question = workbenchState.userQuestions.find((candidate) => {
    if (selection.sessionId && candidate.sessionId === selection.sessionId)
      return true;
    return Boolean(
      selection.agentId && candidate.agentId === selection.agentId,
    );
  });
  if (!question || !selection.sessionId) return;
  const view = ensureConversationView(selection.sessionId);
  const answer = view.composerText.trim();
  if (!answer) return;
  await answerUserQuestion(question.id, answer);
  view.composerText = "";
  composerDraft.text = "";
  workbenchState.userQuestions = await getPendingUserQuestions();
  toast.success("Reply sent");
}

export async function dismissActiveUserQuestion() {
  const question = workbenchState.userQuestions.find((candidate) => {
    if (selection.sessionId && candidate.sessionId === selection.sessionId)
      return true;
    return Boolean(
      selection.agentId && candidate.agentId === selection.agentId,
    );
  });
  if (!question) return;
  await dismissUserQuestionRequest(question.id, "Dismissed from UI.");
  workbenchState.userQuestions = await getPendingUserQuestions();
  toast.message("Question dismissed");
}

export async function abortActiveRun() {
  if (!selection.agentId) return;
  const view = selection.sessionId
    ? ensureConversationView(selection.sessionId)
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
  const view = selection.sessionId
    ? ensureConversationView(selection.sessionId)
    : undefined;
  const text = (view?.composerText ?? composerDraft.text).trim();
  if (!text || view?.sending || workbenchState.sending) return;
  if (text === "/abort") {
    if (view) view.composerText = "";
    composerDraft.text = "";
    await abortActiveRun();
    return;
  }
  if (!selection.projectId || !selection.sessionId || !view) {
    workbenchState.projectPickerOpen = true;
    workbenchState.error =
      "Select a project directory before starting a conversation.";
    return;
  }
  if (
    usableModelOptions(workbenchState.models, workbenchState.authProviders)
      .length === 0
  ) {
    void openSettingsPane();
    view.error = "Configure a model provider in Settings before prompting.";
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
