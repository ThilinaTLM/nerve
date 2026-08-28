<script lang="ts">
import { type QueuedPromptRecord } from "$lib/api";
import { SvelteSet } from "svelte/reactivity";
import { protocolRequest } from "@nervekit/protocol";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { composerDraft } from "$lib/application/workspace/selection.svelte";
import { selectCenterTab } from "$lib/application/workspace/center-tabs.svelte";
import type { CenterTabIdentity } from "$lib/application/workspace";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/kernel/navigation/view-keys";
import {
  modelKey,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { openSettingsPane } from "$lib/application/settings";
import WorkbenchConversationAdapter from "$lib/app/composition/conversations/WorkbenchConversationHost.svelte";
import {
  composerSignals,
  focusComposer,
  openConversationHistory,
} from "$lib/features/conversations/state/composer-signals.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import {
  abortActiveRun,
  cancelActiveCompaction,
  compactActiveConversation,
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
} from "$lib/application/conversations/interactions";
import {
  sendPrompt,
  sendPromptText,
  setActiveComposerText,
} from "$lib/features/conversations/state/prompt-send";
import { agentConfigOverride } from "$lib/features/conversations/state/agent-config-mutations.svelte";
import {
  setComposerMode,
  setComposerModel,
  setComposerPermissionRuleSet,
  setComposerThinkingLevel,
} from "$lib/features/conversations/state/composer-config.svelte";
import { ensureConversationView } from "$lib/features/conversations/state/state";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Sparkles from "@lucide/svelte/icons/sparkles";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { gitContextFingerprint } from "$lib/features/git/state/git-context.svelte";
import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { refreshPromptSuggestions } from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import PromptSuggestionTrustDialog from "$lib/features/prompt-suggestions/components/PromptSuggestionTrustDialog.svelte";
import type { ComposerSuggestion } from "$lib/features/conversations/components/composer-suggestion";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import {
  effectivePermissionRuleSetId,
  selectablePermissionRuleSets,
} from "$lib/kernel/permissions/permission-rule-set-options";
import {
  completeFiles,
  newConversationInProject,
} from "$lib/application/workspace/workspace-actions.svelte";

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
  if (projectId)
    return workspaceState.projects.find((project) => project.id === projectId);
  return paneTab ? undefined : workspaceSelectors.activeProject;
});
const pendingConversationActive = $derived(Boolean(activePendingConversation));
const pendingUserQuestions = $derived.by(() => {
  const agentId = activeAgent?.id;
  return workspaceSelectors.userQuestions.filter((question) => {
    if (conversationId && question.conversationId === conversationId)
      return true;
    return Boolean(agentId && question.agentId === agentId);
  });
});
const pendingPlanReviews = $derived.by(() => {
  const agentId = activeAgent?.id;
  return workspaceSelectors.planReviews.filter((review) => {
    if (conversationId && review.conversationId === conversationId) return true;
    return Boolean(agentId && review.agentId === agentId);
  });
});
const activeApprovals = $derived.by(() => {
  const agentId = activeAgent?.id;
  return workspaceSelectors.approvals.filter((approval) => {
    if (conversationId && approval.conversationId === conversationId)
      return true;
    return Boolean(agentId && approval.agentId === agentId);
  });
});
const planReviewAgent = $derived(
  pendingPlanReviews[0]
    ? workspaceState.agents.find(
        (agent) => agent.id === pendingPlanReviews[0]?.agentId,
      )
    : undefined,
);
// A pending desired override is the immediate display value while an
// `agent.configure` mutation is in flight; the authoritative agent record
// takes over once the mutation settles.
const activeAgentConfigOverride = $derived(
  agentConfigOverride(activeAgent?.id),
);
const selectedModelKey = $derived(
  activePendingConversation?.selectedModelKey ??
    (activeAgentConfigOverride?.model
      ? modelKey(activeAgentConfigOverride.model)
      : activeAgent?.model
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
    activeAgentConfigOverride?.thinkingLevel ??
    activeAgent?.thinkingLevel ??
    "off",
);
const selectedMode = $derived(
  activePendingConversation?.mode ??
    activeAgentConfigOverride?.mode ??
    activeAgent?.mode ??
    activeConversation?.mode ??
    conversationState.selectedMode,
);
const selectedCodingPermissionRuleSetId = $derived(
  activePendingConversation?.permissionRuleSetId ??
    activeAgentConfigOverride?.permissionRuleSetId ??
    activeAgent?.permissionRuleSetId ??
    activeAgent?.permissionLevel ??
    activeConversation?.permissionLevel ??
    conversationState.selectedPermissionRuleSetId,
);
const permissionRuleSets = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
    selectedMode,
  ),
);
const selectedPermissionRuleSetId = $derived(
  effectivePermissionRuleSetId(selectedCodingPermissionRuleSetId, selectedMode),
);
const permissionRuleSetsLoading = $derived(
  permissionRuleSetCatalog.loading(activeProject?.id),
);
const permissionRuleSetsError = $derived(
  permissionRuleSetCatalog.error(activeProject?.id),
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
const conversationUsage = $derived(
  summarizeConversationUsage(view?.entries ?? []),
);
const builtinSuggestionIcons = {
  "commit-changes": GitCommitHorizontal,
  "commit-on-feature-branch": GitBranchPlus,
  "create-pull-request": GitPullRequest,
} as const;
const composerSuggestions = $derived.by<ComposerSuggestion[]>(() =>
  promptSuggestionsState.suggestions.map((suggestion) => ({
    id: `prompt:${suggestion.id}`,
    label: suggestion.label,
    prompt: suggestion.prompt,
    icon:
      suggestion.source.kind === "builtin"
        ? (builtinSuggestionIcons[
            suggestion.name as keyof typeof builtinSuggestionIcons
          ] ?? Sparkles)
        : Sparkles,
  })),
);
const promptSuggestionRefreshKey = $derived.by(() => {
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

async function runActivePaneAction<T>(action: () => T | Promise<T>) {
  await ensurePaneSelected();
  return action();
}

async function jumpToConversationEntry(
  entryId: string | undefined,
  summarize = false,
) {
  const navigated = await runActivePaneAction(() =>
    navigateToEntry(entryId, summarize),
  );
  if (navigated) focusComposer();
}

async function editConversationEntry(entry: {
  parentEntryId?: string;
  text: string;
}) {
  const navigated = await runActivePaneAction(() =>
    navigateToEntry(entry.parentEntryId),
  );
  if (!navigated) return;
  setPaneComposerText(entry.text);
  focusComposer();
}

function openToolFile(path: string, line?: number) {
  if (!activeProject) return;
  void openFilePane({ projectId: activeProject.id, path, line });
}

$effect(() => {
  if (!workbenchStartupState.progressiveActive || !active || !activeProject?.id)
    return;
  void permissionRuleSetCatalog.ensure(activeProject.id);
});

$effect(() => {
  if (!workbenchStartupState.progressiveActive || !active || !activeProject?.id)
    return;
  void promptSuggestionRefreshKey;
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

const forcePushesInFlight = new SvelteSet<string>();

function forcePushQueuedPrompts(prompt: QueuedPromptRecord): Promise<void> {
  return runActivePaneAction(async () => {
    const key = prompt.runId ?? prompt.agentId;
    if (forcePushesInFlight.has(key)) return;
    forcePushesInFlight.add(key);
    try {
      const { result } = await protocolRequest(
        "agent.promptQueue.forcePush",
        { agentId: prompt.agentId },
        { idempotencyKey: crypto.randomUUID() },
      );
      const pushedIds = new Set(result.queuedPromptIds);
      const targetView = ensureConversationView(prompt.conversationId);
      targetView.queuedPrompts = targetView.queuedPrompts.filter(
        (candidate) => !pushedIds.has(candidate.id),
      );
      notify.success(
        result.queuedPromptIds.length === 1
          ? "Queued prompt force pushed"
          : `${result.queuedPromptIds.length} queued prompts force pushed`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      notify.error("Queued prompt action failed", { description: message });
    } finally {
      forcePushesInFlight.delete(key);
    }
  });
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

<WorkbenchConversationAdapter
  {active}
  {activeProject}
  {activeConversation}
  {activeAgent}
  {activePendingConversation}
  {pendingConversationActive}
  homeDir={workspaceState.status?.storage.userHome}
  approvals={activeApprovals}
  {pendingUserQuestions}
  {pendingPlanReviews}
  entries={view?.entries ?? []}
  optimisticMessages={view?.optimisticMessages ?? []}
  toolCalls={view?.toolCalls ?? []}
  treeNodes={view?.treeNodes ?? []}
  activeRun={view?.activeRun}
  transient={view?.transient}
  queuedPrompts={view?.queuedPrompts ?? []}
  sending={activePendingConversation?.sending ?? view?.sending ?? false}
  stopping={view?.stopping ?? false}
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
  permissionRuleSetId={selectedPermissionRuleSetId}
  {permissionRuleSets}
  {permissionRuleSetsLoading}
  {permissionRuleSetsError}
  {slashCompletions}
  contextUsage={view?.contextUsage}
  {conversationUsage}
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
    void runActivePaneAction(
      view?.transient?.compaction?.state === "running"
        ? cancelActiveCompaction
        : abortActiveRun,
    );
  }}
  onCompact={() => {
    void runActivePaneAction(compactActiveConversation);
  }}
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
  onPermissionRuleSetChange={(value) => {
    void runActivePaneAction(() => setComposerPermissionRuleSet(value));
  }}
  onRefreshPermissionRuleSets={() => {
    if (activeProject?.id) {
      void permissionRuleSetCatalog.refresh(activeProject.id);
    }
  }}
  onOpenPermissionSettings={() =>
    void openSettingsPane("permissions", "default-permission")}
  onGrantApproval={grantApproval}
  onDenyApproval={denyApproval}
  onAcceptPlanReview={(id, options) => acceptPendingPlanReview(id, options)}
  onAcceptPlanReviewInNewChat={(id, options) =>
    acceptPendingPlanReviewInNewChat(id, options)}
  onRejectPlanReview={rejectPendingPlanReview}
  onContinueFromFailure={(runId) => {
    void runActivePaneAction(() => continueFromFailure(runId));
  }}
  onForcePushQueuedPrompts={forcePushQueuedPrompts}
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
