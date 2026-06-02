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
import { workbenchState } from "./workbench/state.svelte";
import { entriesToTranscript } from "./workbench/transcript";
import { loadWorkspaceState } from "./workspace.svelte";

export async function openSession(sessionId: string) {
  const session =
    workbenchState.sessions.find((candidate) => candidate.id === sessionId) ??
    (await apiGet<{ session: SessionRecord }>(`/api/sessions/${sessionId}`))
      .session;
  selection.sessionId = session.id;
  selection.projectId = session.projectId;
  selection.agentId =
    session.activeAgentId ??
    workbenchState.agents.find((agent) => agent.sessionId === session.id)?.id;
  selection.entryId = session.activeEntryId;
  const project =
    workbenchState.projects.find(
      (candidate) => candidate.id === session.projectId,
    ) ??
    (
      await apiGet<{ project: ProjectRecord }>(
        `/api/projects/${session.projectId}`,
      )
    ).project;
  composerDraft.projectDir = project.dir;
  const sessionAgent = workbenchState.agents.find(
    (agent) => agent.id === selection.agentId,
  );
  if (sessionAgent?.model) {
    workbenchState.selectedModelKey = modelKey(sessionAgent.model);
  }
  workbenchState.selectedMode = sessionAgent?.mode ?? session.mode;
  workbenchState.selectedPermissionLevel =
    sessionAgent?.permissionLevel ?? session.permissionLevel;
  const [entries, tree] = await Promise.all([
    getSessionMessages(session.id),
    getSessionTree(session.id),
  ]);
  workbenchState.transcript = entriesToTranscript(entries);
  workbenchState.treeNodes = tree.nodes;
  selection.entryId = tree.activeEntryId;
  workbenchState.streamingText = "";
  workbenchState.sending = false;
}

export async function navigateToEntry(
  entryId: string | undefined,
  summarize = false,
) {
  if (!selection.sessionId) return;
  await apiPost(`/api/sessions/${selection.sessionId}/navigate`, {
    activeEntryId: entryId ?? null,
    summarize,
  });
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openSession(selection.sessionId);
}

export async function compactActiveSession() {
  if (!selection.sessionId) return;
  await compactSession(selection.sessionId);
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openSession(selection.sessionId);
}

export function clearConversationState() {
  resetSelection();
  workbenchState.transcript = [];
  workbenchState.treeNodes = [];
  workbenchState.streamingText = "";
  workbenchState.sending = false;
  composerDraft.text = "";
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
  await apiPost(`/api/agents/${selection.agentId}/abort`, {});
  workbenchState.sending = false;
  workbenchState.streamingText = "";
}

export async function sendPrompt() {
  const text = composerDraft.text.trim();
  if (!text || workbenchState.sending) return;
  if (text === "/abort") {
    composerDraft.text = "";
    await abortActiveRun();
    return;
  }
  if (!selection.projectId || !selection.sessionId) {
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
    workbenchState.error =
      "Configure a model provider in Settings before prompting.";
    return;
  }
  workbenchState.sending = true;
  workbenchState.error = undefined;
  workbenchState.streamingText = "";
  try {
    const agentId = await ensureAgent();
    workbenchState.transcript = [
      ...workbenchState.transcript,
      { role: "user", text },
    ];
    composerDraft.text = "";
    await apiPost(`/api/agents/${agentId}/prompt`, { text });
  } catch (caught) {
    workbenchState.error =
      caught instanceof Error ? caught.message : String(caught);
    workbenchState.sending = false;
  }
}
