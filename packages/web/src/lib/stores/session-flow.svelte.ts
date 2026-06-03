import { toast } from "svelte-sonner";
import {
  type AgentRecord,
  apiGet,
  apiPost,
  compactSession,
  getPendingApprovals,
  getSessionMessages,
  getSessionTree,
  type ProjectRecord,
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
} from "./composer-config.svelte";
import { navigateToSettingsPanel } from "./settings.svelte";
import {
  filterStoredTabsAgainstSessions,
  loadStoredConversationTabs,
  saveConversationTabs,
} from "./workbench/conversation-tabs";
import type { ConversationViewState } from "./workbench/state.svelte";
import { workbenchState } from "./workbench/state.svelte";
import { entriesToTranscript } from "./workbench/transcript";
import { loadWorkspaceState } from "./workspace.svelte";

export function ensureConversationView(
  sessionId: string,
): ConversationViewState {
  workbenchState.conversationViews[sessionId] ??= {
    sessionId,
    transcript: [],
    treeNodes: [],
    streamingText: "",
    sending: false,
    composerText: "",
    loading: false,
  };
  return workbenchState.conversationViews[sessionId];
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
    const [entries, tree] = await Promise.all([
      getSessionMessages(sessionId),
      getSessionTree(sessionId),
    ]);
    const nextTranscript = entriesToTranscript(entries);
    if (!view.sending || nextTranscript.length >= view.transcript.length) {
      view.transcript = nextTranscript;
    }
    view.treeNodes = tree.nodes;
    if (selection.sessionId === sessionId) {
      selection.entryId = tree.activeEntryId;
      workbenchState.treeNodes = tree.nodes;
      workbenchState.transcript = view.transcript;
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

  if (selection.sessionId !== sessionId) {
    persistConversationTabs();
    return;
  }

  const nextSessionId = nextIds[closingIndex] ?? nextIds[closingIndex - 1];
  if (nextSessionId) {
    workbenchState.activeConversationTabId = nextSessionId;
    persistConversationTabs();
    await openSession(nextSessionId);
    return;
  }

  clearActiveSelection();
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
  workbenchState.activeConversationTabId = undefined;
  workbenchState.conversationViews = {};
  clearActiveSelection();
  persistConversationTabs();
}

export async function ensureAgent(): Promise<string> {
  if (selection.agentId) {
    const agent = currentActiveAgent();
    const { desired, needsModel, needsMode, needsPermission } =
      agentNeedsComposerUpdate(agent);
    if (needsModel || needsMode || needsPermission) {
      const updated = await updateAgentConfig(selection.agentId, {
        model: desired ?? null,
        mode: workbenchState.selectedMode,
        permissionLevel: workbenchState.selectedPermissionLevel,
      }).catch(() => undefined);
      if (updated) {
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

export async function abortActiveRun() {
  if (!selection.agentId) return;
  const view = selection.sessionId
    ? ensureConversationView(selection.sessionId)
    : undefined;
  await apiPost(`/api/agents/${selection.agentId}/abort`, {});
  if (view) {
    view.sending = false;
    view.streamingText = "";
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
    navigateToSettingsPanel();
    view.error = "Configure a model provider in Settings before prompting.";
    workbenchState.error = view.error;
    return;
  }
  view.sending = true;
  view.error = undefined;
  view.streamingText = "";
  workbenchState.sending = true;
  workbenchState.error = undefined;
  workbenchState.streamingText = "";
  try {
    const agentId = await ensureAgent();
    view.transcript = [...view.transcript, { role: "user", text }];
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
