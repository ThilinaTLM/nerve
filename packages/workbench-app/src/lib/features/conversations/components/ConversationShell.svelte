<script lang="ts">
import { type QueuedPromptRecord } from "$lib/api";
import { protocolRequest } from "@nervekit/protocol";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { composerDraft } from "$lib/features/workspace/state/selection.svelte";
import { selectCenterTab } from "$lib/features/workspace/state/center-tabs.svelte";
import type { CenterTabIdentity } from "$lib/features/workspace";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/core/state/state-keys";
import {
  modelKey,
  scopedUsableModelOptions,
} from "@nervekit/workbench-ui/core/utils/model";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ConversationPane from "$lib/features/conversations/components/ConversationPane.svelte";
import {
  composerSignals,
  focusComposer,
  openConversationHistory,
} from "$lib/features/conversations/state/composer-signals.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import {
  abortActiveRun,
  continueFromFailure,
  navigateToEntry,
} from "$lib/features/conversations/state/run-control";
import {
  acceptPendingPlanReview,
  acceptPendingPlanReviewInNewChat,
  answerUserQuestionById,
  denyApproval,
  dismissUserQuestionById,
  grantApproval,
  rejectPendingPlanReview,
} from "$lib/features/conversations/state/interactions";
import {
  sendPrompt,
  sendPromptText,
  setActiveComposerText,
} from "$lib/features/conversations/state/prompt-send";
import {
  setComposerApprovalPolicy,
  setComposerMode,
  setComposerModel,
  setComposerPermission,
  setComposerThinkingLevel,
} from "$lib/features/conversations/state/composer-config.svelte";
import { ensureConversationView } from "$lib/features/conversations/state/state";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Sparkles from "@lucide/svelte/icons/sparkles";
import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { gitContextFingerprint } from "$lib/features/git/state/git-context.svelte";
import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
import { refreshPromptSuggestions } from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";
import PromptSuggestionTrustDialog from "$lib/features/prompt-suggestions/components/PromptSuggestionTrustDialog.svelte";
import type { ComposerSuggestion } from "./composer-suggestion";
import {
  completeFiles,
  newConversationInProject,
} from "$lib/features/workspace/state/workspace-actions.svelte";

type Props = {
  tab?: CenterTabIdentity;
  active?: boolean;
};

let { tab, active = true }: Props = $props();

const paneTab = $derived(tab ?? workspaceState.activeCenterTab);
const conversationId = $derived(
  paneTab?.kind === "conversation" ? paneTab.id : undefined,
);
const pendingId = $derived(
  paneTab?.kind === "pending-conversation" ? paneTab.id : undefined,
);
const view = $derived(
  conversationId
    ? conversationState.conversationViews[conversationViewKey(conversationId)]
    : undefined,
);
const activePendingConversation = $derived(
  pendingId
    ? conversationState.pendingConversations[pendingConversationKey(pendingId)]
    : undefined,
);
const activeConversation = $derived(
  conversationId
    ? workspaceState.conversations.find(
        (conversation) => conversation.id === conversationId,
      )
    : undefined,
);
const activeAgent = $derived(
  activeConversation
    ? workspaceState.agents.find(
        (agent) =>
          agent.id === activeConversation.activeAgentId ||
          agent.conversationId === activeConversation.id,
      )
    : undefined,
);
const activeProject = $derived.by(() => {
  const projectId =
    activePendingConversation?.projectId ?? activeConversation?.projectId;
  return projectId
    ? workspaceState.projects.find((project) => project.id === projectId)
    : undefined;
});
const pendingConversationActive = $derived(Boolean(activePendingConversation));
const pendingUserQuestion = $derived.by(() => {
  const agentId = activeAgent?.id;
  return workspaceState.userQuestions.find((question) => {
    if (conversationId && question.conversationId === conversationId)
      return true;
    return Boolean(agentId && question.agentId === agentId);
  });
});
const pendingPlanReview = $derived.by(() => {
  const agentId = activeAgent?.id;
  return workspaceState.planReviews.find((review) => {
    if (conversationId && review.conversationId === conversationId) return true;
    return Boolean(agentId && review.agentId === agentId);
  });
});
const activeApprovals = $derived.by(() => {
  const agentId = activeAgent?.id;
  return workspaceState.approvals.filter((approval) => {
    if (conversationId && approval.conversationId === conversationId)
      return true;
    return Boolean(agentId && approval.agentId === agentId);
  });
});
const planReviewAgent = $derived(
  pendingPlanReview
    ? workspaceState.agents.find(
        (agent) => agent.id === pendingPlanReview.agentId,
      )
    : undefined,
);
const selectedModelKey = $derived(
  activePendingConversation?.selectedModelKey ??
    (activeAgent?.model
      ? modelKey(activeAgent.model)
      : conversationState.selectedModelKey),
);
const selectedModelInfo = $derived(
  settingsState.models.find((model) => modelKey(model) === selectedModelKey),
);
const activeAgentModel = $derived(activeAgent?.model);
const activeModelInfo = $derived(
  activeAgentModel
    ? settingsState.models.find(
        (model) => modelKey(model) === modelKey(activeAgentModel),
      )
    : undefined,
);
const selectedThinkingLevel = $derived(
  activePendingConversation?.thinkingLevel ??
    activeAgent?.thinkingLevel ??
    "off",
);
const selectedMode = $derived(
  activePendingConversation?.mode ??
    activeAgent?.mode ??
    activeConversation?.mode ??
    conversationState.selectedMode,
);
const selectedPermissionLevel = $derived(
  activePendingConversation?.permissionLevel ??
    activeAgent?.permissionLevel ??
    activeConversation?.permissionLevel ??
    conversationState.selectedPermissionLevel,
);
const selectedApprovalPolicy = $derived(
  activePendingConversation?.approvalPolicy ??
    activeAgent?.approvalPolicy ??
    activeConversation?.approvalPolicy ??
    conversationState.selectedApprovalPolicy,
);
const activeComposerText = $derived(
  activePendingConversation?.composerText ?? view?.composerText ?? "",
);
const usableModels = $derived(
  scopedUsableModelOptions(
    settingsState.models,
    settingsState.authProviders,
    settingsState.settingsDraft?.scopedModels,
  ),
);
const planReviewModelKey = $derived(
  planReviewAgent?.model ? modelKey(planReviewAgent.model) : selectedModelKey,
);
const planReviewThinkingLevel = $derived(
  planReviewAgent?.thinkingLevel ?? selectedThinkingLevel,
);
const contextWindow = $derived(
  selectedModelInfo?.contextWindow ??
    activeModelInfo?.contextWindow ??
    view?.contextUsage?.contextWindow ??
    0,
);
const gitSuggestions = $derived(active ? gitSelectors.gitSuggestions : []);
const gitSuggestionIcons = {
  commit: GitCommitHorizontal,
  "commit-branch": GitBranchPlus,
  "open-pr": GitPullRequest,
} as const;
const composerSuggestions = $derived.by<ComposerSuggestion[]>(() => [
  ...gitSuggestions.map((suggestion) => ({
    ...suggestion,
    icon: gitSuggestionIcons[suggestion.id],
  })),
  ...promptSuggestionsState.suggestions.map((suggestion) => ({
    id: `file:${suggestion.id}`,
    label: suggestion.label,
    prompt: suggestion.prompt,
    icon: Sparkles,
  })),
]);
const gitSuggestionRefreshKey = $derived.by(() => {
  const ctx = gitState.gitContext;
  return ctx ? `${ctx.projectId}:${gitContextFingerprint(ctx)}` : "none";
});
const slashCompletions = $derived(
  active ? conversationState.slashCompletions : [],
);

function tabsEqual(
  left: CenterTabIdentity | undefined,
  right: CenterTabIdentity | undefined,
): boolean {
  return Boolean(
    left && right && left.kind === right.kind && left.id === right.id,
  );
}

async function ensurePaneSelected() {
  const target = paneTab;
  if (!target || tabsEqual(workspaceState.activeCenterTab, target)) return;
  await selectCenterTab(target);
}

function setPaneComposerText(value: string) {
  const pending = activePendingConversation;
  if (pending) {
    pending.composerText = value;
    return;
  }
  if (conversationId) {
    ensureConversationView(conversationId).composerText = value;
    return;
  }
  if (active && tabsEqual(workspaceState.activeCenterTab, paneTab)) {
    setActiveComposerText(value);
    return;
  }
  composerDraft.text = value;
}

async function runActivePaneAction(action: () => void | Promise<void>) {
  await ensurePaneSelected();
  await action();
}

async function jumpToConversationEntry(
  entryId: string | undefined,
  summarize = false,
) {
  await runActivePaneAction(() => navigateToEntry(entryId, summarize));
  focusComposer();
}

async function editConversationEntry(entry: {
  parentEntryId?: string;
  text: string;
}) {
  await runActivePaneAction(() => navigateToEntry(entry.parentEntryId));
  setPaneComposerText(entry.text);
  focusComposer();
}

function openProjectPicker() {
  workspaceState.projectPickerOpen = true;
}

function openToolFile(path: string, line?: number) {
  if (!activeProject) return;
  void openFilePane({ projectId: activeProject.id, path, line });
}

$effect(() => {
  if (!active || !activeProject?.id) return;
  void gitSuggestionRefreshKey;
  void refreshPromptSuggestions(activeProject.id, {
    conversationId,
    agentId: activeAgent?.id,
  });
});

function applySuggestion(suggestion: { prompt: string }) {
  const current = activeComposerText.trim();
  setPaneComposerText(
    current
      ? `${activeComposerText}\n\n${suggestion.prompt}`
      : suggestion.prompt,
  );
}

function sendSuggestion(suggestion: { prompt: string }) {
  void runActivePaneAction(() =>
    sendPromptText(suggestion.prompt, { clearComposer: false }),
  );
}

async function cancelQueuedPrompt(
  prompt: QueuedPromptRecord,
): Promise<boolean> {
  try {
    await protocolRequest("agent.promptQueue.cancel", {
      agentId: prompt.agentId,
      queuedPromptId: prompt.id,
    });
    const targetView = ensureConversationView(prompt.conversationId);
    targetView.queuedPrompts = targetView.queuedPrompts.filter(
      (candidate) => candidate.id !== prompt.id,
    );
    return true;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    notify.error("Queued prompt action failed", { description: message });
    return false;
  }
}

function discardQueuedPrompt(prompt: QueuedPromptRecord) {
  void runActivePaneAction(async () => {
    if (!(await cancelQueuedPrompt(prompt))) return;
    notify.message("Queued prompt discarded");
  });
}

function moveQueuedPromptToComposer(prompt: QueuedPromptRecord) {
  void runActivePaneAction(async () => {
    if (!(await cancelQueuedPrompt(prompt))) return;
    setPaneComposerText(prompt.text);
    focusComposer();
    notify.success("Moved queued prompt to composer");
  });
}
</script>

<ConversationPane
  {active}
  {activeProject}
  {activeConversation}
  {activeAgent}
  {activePendingConversation}
  {pendingConversationActive}
  projects={workspaceState.projects}
  conversations={workspaceState.conversations}
  agents={workspaceState.agents}
  homeDir={workspaceState.status?.storage.home}
  approvals={activeApprovals}
  {pendingUserQuestion}
  {pendingPlanReview}
  transcript={view?.transcript ?? []}
  toolCalls={view?.toolCalls ?? []}
  treeNodes={view?.treeNodes ?? []}
  streamingText={view?.streamingText ?? ""}
  liveState={view?.live}
  queuedPrompts={view?.queuedPrompts ?? []}
  live={workspaceState.connection === "live"}
  sending={activePendingConversation?.sending ?? view?.sending ?? false}
  composerText={activeComposerText}
  {composerSuggestions}
  onSendSuggestion={sendSuggestion}
  onDraftSuggestion={applySuggestion}
  models={usableModels}
  {selectedModelKey}
  thinkingLevel={selectedThinkingLevel}
  planReviewModels={usableModels}
  {planReviewModelKey}
  {planReviewThinkingLevel}
  mode={selectedMode}
  permissionLevel={selectedPermissionLevel}
  approvalPolicy={selectedApprovalPolicy}
  {slashCompletions}
  contextUsage={view?.contextUsage}
  {contextWindow}
  composerFocusToken={composerSignals.focusToken}
  composerEscapeToken={composerSignals.escapeToken}
  micShortcutToken={composerSignals.micToken}
  fileCompletions={active ? completeFiles : undefined}
  onComposerChange={setPaneComposerText}
  onSubmit={() => {
    void runActivePaneAction(sendPrompt);
  }}
  onAnswerUserQuestion={answerUserQuestionById}
  onDismissUserQuestion={dismissUserQuestionById}
  onAbort={() => {
    void runActivePaneAction(abortActiveRun);
  }}
  onOpenProject={openProjectPicker}
  onNewConversationInProject={newConversationInProject}
  onOpenFile={openToolFile}
  onModelChange={(value) => {
    void runActivePaneAction(() => setComposerModel(value));
  }}
  onThinkingLevelChange={(value) => {
    void runActivePaneAction(() => setComposerThinkingLevel(value));
  }}
  onModeChange={(value) => {
    void runActivePaneAction(() => setComposerMode(value));
  }}
  onPermissionChange={(value) => {
    void runActivePaneAction(() => setComposerPermission(value));
  }}
  onApprovalPolicyChange={(value) => {
    void runActivePaneAction(() => setComposerApprovalPolicy(value));
  }}
  onGrantApproval={(id) => void grantApproval(id)}
  onDenyApproval={(id) => void denyApproval(id)}
  onAcceptPlanReview={(id, options) => acceptPendingPlanReview(id, options)}
  onAcceptPlanReviewInNewChat={(id, options) =>
    acceptPendingPlanReviewInNewChat(id, options)}
  onRejectPlanReview={(id) => void rejectPendingPlanReview(id)}
  onContinueFromFailure={(id) => {
    void runActivePaneAction(() => continueFromFailure(id));
  }}
  onDiscardQueuedPrompt={discardQueuedPrompt}
  onMoveQueuedPromptToComposer={moveQueuedPromptToComposer}
  onNavigateToEntry={(entryId, summarize) => {
    void jumpToConversationEntry(entryId, summarize);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
  onOpenHistory={() => {
    void runActivePaneAction(openConversationHistory);
  }}
/>

<PromptSuggestionTrustDialog
  projectId={activeProject?.id}
  {conversationId}
  agentId={activeAgent?.id}
/>
