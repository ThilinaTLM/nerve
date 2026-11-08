<script lang="ts">
import { untrack } from "svelte";
import ProfileUpdateNotice from "$lib/features/conversations/views/ProfileUpdateNotice.svelte";
import { projectAgentDefaults } from "$lib/application/agent-configuration/project-agent-defaults.svelte";
import { CreationPreferencesState } from "$lib/features/settings/state/creation-preferences.svelte";
import { compareSubagents } from "$lib/presentation/conversations/subagent-order";
import { createComposerView } from "$lib/application/composer/composer-view.svelte";
import { activateComposer } from "$lib/application/composer/active-composer.svelte";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import PromptSuggestionTrustDialog from "$lib/features/prompt-suggestions/views/PromptSuggestionTrustDialog.svelte";
import type { EventTreeNode } from "@nervekit/contracts/core";
import type { CompletionItem } from "@nervekit/contracts/completions";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { pendingConversations } from "$lib/application/workspace/pending-conversations.svelte";
import {
  conversationDraftStore,
  type PromptDraftTarget,
} from "$lib/application/workspace/conversation-draft-store";
import type { CenterTabIdentity } from "$lib/application/workspace";
import { newConversationInProject } from "$lib/application/workspace/workspace-actions.svelte";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import {
  modelKey,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import { openSettingsPane } from "$lib/application/settings";
import WorkbenchConversationAdapter from "$lib/app/composition/conversations/WorkbenchConversationHost.svelte";
import { conversationCatalog } from "$lib/features/conversations/state/conversation-catalog.svelte";
import {
  composerSignals,
  focusComposer,
} from "$lib/features/conversations/state/composer-signals.svelte";
import ConversationHistoryHost from "$lib/app/composition/conversations/ConversationHistoryHost.svelte";
import type { TranscriptView } from "$lib/presentation/conversations";
import {
  committedTranscript,
  liveTranscript,
} from "$lib/features/conversations/adapters/core-transcript.adapter";

import {
  conversationContext,
  projectView,
} from "$lib/features/conversations/adapters/core-context.adapter";
import {
  requestConversation,
  observeConversationChannel,
} from "$lib/application/startup/conversation-connection";
import ConversationActivityIsland from "$lib/features/conversations/agents/ConversationActivityIsland.svelte";
import { openAsyncBashTab } from "$lib/features/conversations";
import { hasStoppableWork } from "$lib/features/conversations/agents/agent-team";
import ConversationSettingsDialogs from "$lib/features/conversations/context/ConversationSettingsDialogs.svelte";
import ConversationContextActions from "$lib/features/conversations/context/ConversationContextActions.svelte";
import { ConversationCompactionState } from "$lib/features/conversations/context/conversation-compaction-state.svelte";
import { sessionFields } from "$lib/features/conversations/views/context-session-fields";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import type { AsyncBash } from "@nervekit/contracts/core";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { openLaunchTab } from "$lib/features/launches";
import { composerReferenceSource } from "$lib/app/composition/conversations/composer-reference-completions";
import { notify } from "$lib/application/notifications/notify.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import { DEFAULT_AGENT_PROFILE } from "@nervekit/contracts/agent-profiles";
import { selectablePermissionRuleSets } from "$lib/domain/permissions/rule-set-options";
import {
  agentProfileCatalog,
  leadAgentProfiles,
} from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import {
  createComposerConfigActions,
  createSystemPromptOpener,
} from "./conversation-center/composer-config.svelte";
import { createInteractionActions } from "./conversation-center/interaction-actions.svelte";
import { ComposerSession } from "./conversation-center/composer-session.svelte";
import { runActivePaneAction } from "./conversation-center/prompt-submission.svelte";
import {
  forkConversation,
  isForking,
} from "./conversation-center/fork-conversation.svelte";
import { createQueuedPromptActions } from "./conversation-center/queued-prompts.svelte";
import { CenterPromptSuggestions } from "./conversation-center/prompt-suggestions.svelte";
import { ConversationAgentView } from "./conversation-center/agent-view.svelte";
import { ConversationUsage } from "./conversation-center/conversation-usage.svelte";
import {
  composerProfiles as deriveComposerProfiles,
  permissionRuleSetsFor,
} from "./conversation-center/composer-options";
let { tab, active = true }: { tab?: CenterTabIdentity; active?: boolean } =
  $props();
const paneTab = $derived(tab ?? workspaceState.activeCenterTab);
const conversationId = $derived(
  paneTab?.kind === "conversation" ? paneTab.id : undefined,
);
const pendingId = $derived(
  paneTab?.kind === "pending-conversation" ? paneTab.id : undefined,
);
const activePendingConversation = $derived(
  pendingId ? pendingConversations.get(pendingId) : undefined,
);
const pendingConversationActive = $derived(!!activePendingConversation);
let tree = $state<EventTreeNode[]>([]);
const agentView = new ConversationAgentView({
  conversationId: () => conversationId,
  context: () => context,
  clearEdit: () => composerSession.clearEdit(),
  resetTree: () => {
    tree = [];
  },
});
/** Everything below acts on the conversation being viewed. */
const store = $derived(agentView.store);
const drafts = conversationDraftStore();
// The composer belongs to the lead, even while a read-only child is viewed.
const promptDraftTarget = $derived<PromptDraftTarget | undefined>(
  activePendingConversation
    ? {
        kind: "pending-conversation",
        id: activePendingConversation.id,
        projectId: activePendingConversation.projectId,
      }
    : conversationId
      ? { kind: "conversation", id: conversationId }
      : undefined,
);
const composerSession = new ComposerSession({
  store: () => store,
  promptDraftTarget: () => promptDraftTarget,
  pending: () => activePendingConversation,
  viewedChildId: () => agentView.viewedChildId,
  inherited: () => composerView.inherited,
  drafts,
  focusComposer,
});
// Durable projection: recomputes on append/head/snapshot changes only, so its
// `entries` and `toolCalls` keep identity while deltas stream.
const transcript = $derived(
  store?.snapshot
    ? committedTranscript({
        snapshot: store.snapshot,
        events: store.events,
        tree,
      })
    : undefined,
);
// Live projection: depends on live blocks, tool output and the run context.
const activeRun = $derived(
  transcript
    ? liveTranscript({
        run: transcript.run,
        queuedPrompts: transcript.queuedPrompts,
        liveBlocks: store?.liveBlocks ?? [],
        toolOutput: store?.toolOutput ?? {},
      })
    : undefined,
);
const view = $derived(
  store?.snapshot && transcript
    ? {
        ...transcript,
        activeRun,
        stopping:
          Boolean(store?.stopping) ||
          Boolean(transcript.transient?.compaction?.stopping),
        retryingResponse: composerSession.retryingResponse,
        responseRevision: store.responseRevision,
        transient: transcript.transient,
      }
    : undefined,
);
const context: ReturnType<typeof conversationContext> | undefined = $derived(
  store?.snapshot
    ? conversationContext(store.snapshot, store.events, settingsState.models)
    : undefined,
);
const activeConversation = $derived(context?.activeConversation);
const activeAgent = $derived(context?.activeAgent);
const activeProject = $derived.by(() => {
  const id =
    activePendingConversation?.projectId ??
    store?.snapshot?.conversation.projectId;
  const project = id
    ? workspaceState.projects.find((p) => p.id === id)
    : workspaceSelectors.activeProject;
  return project ? projectView(project) : undefined;
});
const activeApprovals = $derived(view?.approvals ?? []);
const pendingUserQuestions = $derived(view?.pendingUserQuestions ?? []);
const pendingPlanReviews = $derived(view?.pendingPlanReviews ?? []);
const profileCatalogProjectId = $derived(
  activePendingConversation?.projectId ??
    store?.snapshot?.conversation.projectId,
);
const resolvedProfiles = $derived(
  agentProfileCatalog.profiles(profileCatalogProjectId),
);
const effective = $derived(
  store?.effective?.status === "available" ? store.effective : undefined,
);
const creationPreferences = new CreationPreferencesState();
$effect(() => {
  if (activeProject?.id)
    void creationPreferences.load({
      scope: "project",
      projectId: activeProject.id,
    });
});
$effect(() => creationPreferences.observe());
const creationDefaults = $derived(
  creationPreferences.result?.status === "available"
    ? creationPreferences.result.effective
    : undefined,
);
const composerView = createComposerView({
  target: () =>
    activePendingConversation
      ? {
          kind: "draft",
          pendingId: activePendingConversation.id,
          projectId: activePendingConversation.projectId,
        }
      : {
          kind: "conversation",
          conversationId: agentView.viewedChildId ?? conversationId ?? "",
          readOnly: !!agentView.viewedChildId,
        },
  pending: () => activePendingConversation,
  store: () => store,
  defaults: (projectId) => projectAgentDefaults.get(projectId),
  profiles: (projectId) => agentProfileCatalog.profiles(projectId),
  resolve: (input) =>
    requestConversation("agentConfiguration.resolveProject", input),
  clampReasoning: (key, level) =>
    clampThinkingLevelForModel(
      level,
      settingsState.models.find((m) => modelKey(m) === key),
    ),
  capabilityEditor: new ScopedAgentState(),
  observe: (invalidate) => {
    const stop = observeConversationChannel({
      recover: () => {
        invalidate();
        return Promise.resolve();
      },
      disconnected() {},
      event() {},
      notice: (notice) => {
        if (
          notice.type !== "agentConfiguration.changed" &&
          notice.type !== "conversationDefaults.changed"
        )
          return;
        const scope = notice.data.scope;
        if (
          scope.scope === "user" ||
          (scope.scope === "project" &&
            scope.projectId === activeProject?.id) ||
          (scope.scope === "conversation" &&
            scope.conversationId === conversationId)
        )
          invalidate();
      },
    });
    const stopProfiles = onEvent("agentProfiles.changed", () => {
      void agentProfileCatalog.refresh(activeProject?.id).then(() => {
        // Drafts track the refreshed catalog directly; do not resolve twice.
        if (!activePendingConversation) invalidate();
      });
    });
    return () => {
      stop();
      stopProfiles();
    };
  },
});
$effect(() => {
  if (active) return activateComposer(composerView);
});
const composerResolution = $derived(composerView.resolution);
const selectedModelKey = $derived(
  composerResolution?.settings.model
    ? modelKey(composerResolution.settings.model)
    : "",
);
const selectedThinkingLevel = $derived(
  composerResolution?.settings.reasoningLevel ?? "off",
);
const selectedAgentProfile = $derived(
  composerView.appliedProfile ?? DEFAULT_AGENT_PROFILE,
);
const selectedPermissionRuleSetId = $derived(
  composerResolution?.settings.permissionRuleSetId ?? "autonomous",
);
const composerProfiles = $derived(
  deriveComposerProfiles({
    viewingChild: Boolean(agentView.viewedChildId),
    selectedProfile: selectedAgentProfile,
    resolvedProfiles,
    leadProfiles: leadAgentProfiles(resolvedProfiles),
  }),
);
const lockedFields = $derived({
  ...composerView.locked,
  by: composerView.appliedProfile,
});
const activeCompactionLocked = $derived(Boolean(lockedFields.compaction));
$effect(() => {
  void agentProfileCatalog.ensure(profileCatalogProjectId);
});
const usableModels = $derived(
  scopedUsableModelOptions(
    settingsState.models,
    settingsState.authProviders,
    creationDefaults?.scopedModels,
  ),
);
const planReviewModelKey = $derived(selectedModelKey);
const planReviewThinkingLevel = $derived(selectedThinkingLevel);
const permissionRuleSets = $derived(
  permissionRuleSetsFor(
    selectablePermissionRuleSets(
      permissionRuleSetCatalog.summaries(activeProject?.id),
    ),
    Boolean(agentView.viewedChildId),
  ),
);
const permissionRuleSetsLoading = $derived(
  permissionRuleSetCatalog.loading(activeProject?.id),
);
const permissionRuleSetsError = $derived(
  permissionRuleSetCatalog.error(activeProject?.id),
);
let slashCompletions = $state<CompletionItem[]>([]);
$effect(() => {
  if (!activeProject) return;
  void requestConversation("completion.slash.list", {}).then((r) => {
    slashCompletions = r.items;
    conversationCatalog.slashCompletions = r.items;
  });
  void permissionRuleSetCatalog.refresh(activeProject.id);
});
const conversationUsage = $derived(
  context?.conversationUsage ?? summarizeConversationUsage([]),
);
const usage = new ConversationUsage({
  conversationId: () => store?.conversationId,
  enabled: () => active && !!store?.connected,
  responseCount: () => conversationUsage.responseCount,
  contextWindow: () => context?.contextWindow,
  selectedModelKey: () => selectedModelKey,
});
const promptSuggestions = new CenterPromptSuggestions({
  active: () => active,
  projectId: () => activeProject?.id,
  store: () => store,
  conversationId: () => conversationId,
});
async function compactActiveConversation() {
  await store?.control("compact");
}
async function cancelPendingCompaction() {
  await store?.cancelCompaction();
}
const openSystemPrompt = createSystemPromptOpener({
  pending: () => activePendingConversation,
  inherited: () => composerView.inherited,
  profiles: () => resolvedProfiles,
  conversation: () => store?.snapshot?.conversation,
});
const cancelActiveCompaction = composerSession.abortActiveRun;
function openToolFile(path: string, line?: number) {
  if (activeProject)
    void openFilePane({ projectId: activeProject.id, path, line });
}
function openTaskFromNotice(id: string) {
  const command = store?.snapshot?.asyncBash.find(
    (candidate) => candidate.id === id,
  );
  if (command) void openAsyncBashTab(command, activeProject?.id);
  else void openLaunchTab(id);
}
const {
  setComposerModelSelection,
  setComposerAgentProfile,
  setComposerPermissionRuleSet,
} = createComposerConfigActions(composerView);
const {
  answerUserQuestion,
  dismissUserQuestion,
  grantApproval,
  denyApproval,
  acceptPendingPlanReview,
  rejectPendingPlanReview,
} = createInteractionActions(() => store);
const continueFromFailure: (runId: string) => Promise<null> | undefined = () =>
  store?.control("continue");
const {
  forcePushQueuedPrompts,
  discardQueuedPrompt,
  moveQueuedPromptToComposer,
} = createQueuedPromptActions({
  store: () => store,
  setComposerText: composerSession.setComposerText,
});
// The transcript area shows the conversation or its History, per pane.
let transcriptView = $state<TranscriptView>("conversation");
$effect(() => {
  void conversationId;
  transcriptView = "conversation";
});
let handledHistoryRequest = untrack(() => composerSignals.historyRequest.token);
$effect(() => {
  const request = composerSignals.historyRequest;
  if (request.token === handledHistoryRequest) return;
  handledHistoryRequest = request.token;
  if (!active || !store?.snapshot) return;
  transcriptView =
    request.mode === "open"
      ? "history"
      : request.mode === "close"
        ? "conversation"
        : transcriptView === "history"
          ? "conversation"
          : "history";
});
function toggleHistory() {
  transcriptView = transcriptView === "history" ? "conversation" : "history";
}
async function rewindFromHistory(entryId: string | undefined) {
  await jumpToConversationEntry(entryId);
  transcriptView = "conversation";
  focusComposer();
}

const jumpToConversationEntry: (
  id: string | undefined,
  summarize?: boolean,
) => Promise<void> = async (id) => {
  await store?.selectHead(id ?? null);
};
$effect(() => {
  const entry = composerSignals.editEntry;
  if (
    active &&
    entry &&
    entry.conversationId === conversationId &&
    !agentView.viewedChildId
  ) {
    composerSignals.editEntry = undefined;
    composerSession.editEntry(entry);
  }
});
const completionProjectId = $derived(activeProject?.id);
const completionConversationId = $derived(
  agentView.viewedChildId ?? conversationId,
);
// Construction is inert; only an active editor query acquires server data.
const completionSource = $derived(
  active && completionProjectId
    ? composerReferenceSource(completionProjectId, completionConversationId)
    : undefined,
);
const backgroundCommands = $derived(store?.snapshot?.asyncBash ?? []);
function openCommand(command: AsyncBash) {
  void openAsyncBashTab(command, activeProject?.id);
}
const compactionSettings = new ConversationCompactionState();
$effect(() =>
  compactionSettings.follow(
    activeProject?.id,
    store?.snapshot?.conversation.id,
  ),
);
$effect(() => compactionSettings.observe());
let compactionDialogOpen = $state(false);
let instructionsDialogOpen = $state(false);
const instructions = $derived(store?.snapshot?.config.instructions ?? null);
const session = $derived({
  fields: sessionFields({
    status: workspaceState.status,
    activeProject,
    activeConversation,
  }),
  onCopy: (text: string, label: string) => {
    void writeClipboardText(text).then(
      () => notify.success(`Copied ${label}`),
      () => notify.error("Could not copy to clipboard"),
    );
  },
});
const stoppable = $derived(hasStoppableWork(store?.snapshot));
// A fork needs the source idle, so history actions wait for it to finish.
const historyLocked = $derived(stoppable || isForking(conversationId));
</script>

<WorkbenchConversationAdapter
  {active}
  pendingWork={agentView.pendingWork}
  onOpenPendingWork={agentView.openPendingWork}
  subagents={{
    list: () =>
      [...(agentView.leadStore?.snapshot?.children ?? [])]
        .sort(compareSubagents)
        .map((child) => ({
          id: child.id,
          name: child.title,
          status: child.status,
        })),
    open: (id) => agentView.viewAgent(id),
  }}
  editorOverlay={agentView.composerOverlay}
  {session}
  {activeProject}
  {activeConversation}
  {activeAgent}
  {activePendingConversation}
  {pendingConversationActive}
  conversationLoading={Boolean(
    conversationId && !store?.snapshot && !store?.error,
  )}
  approvals={activeApprovals}
  {pendingUserQuestions}
  {pendingPlanReviews}
  entries={view?.entries ?? []}
  optimisticMessages={view?.optimisticMessages ?? []}
  toolCalls={view?.toolCalls ?? []}
  treeNodes={view?.treeNodes ?? []}
  activeRun={view?.activeRun}
  lastRunOutcome={view?.lastRunOutcome}
  transient={view?.transient}
  queuedPrompts={view?.queuedPrompts ?? []}
  recoveryIssues={view?.recoveryIssues ?? []}
  sending={activePendingConversation?.sending ?? view?.sending ?? false}
  {stoppable}
  stopping={view?.stopping ?? false}
  retryingResponse={view?.retryingResponse ?? false}
  responseRevision={view?.responseRevision ?? 0}
  composerText={composerSession.composerText}
  composerSuggestions={agentView.viewedChildId
    ? []
    : promptSuggestions.suggestions}
  onSendSuggestion={composerSession.sendSuggestion}
  onDraftSuggestion={composerSession.applySuggestion}
  models={usableModels}
  {selectedModelKey}
  thinkingLevel={selectedThinkingLevel}
  planReviewModels={usableModels}
  {planReviewModelKey}
  {planReviewThinkingLevel}
  agentProfile={selectedAgentProfile}
  agentProfiles={composerProfiles}
  {lockedFields}
  profileDisabled={Boolean(agentView.viewedChildId)}
  permissionRuleSetId={selectedPermissionRuleSetId}
  {permissionRuleSets}
  {permissionRuleSetsLoading}
  {permissionRuleSetsError}
  {slashCompletions}
  contextUsage={context?.contextUsage}
  {conversationUsage}
  agentUsage={usage.agentState.usage}
  agentUsageLoading={usage.agentState.loading}
  agentUsageError={usage.agentState.error}
  onUsageOpenChange={(open) => {
    usage.open = open;
  }}
  onUsageRetry={() => usage.retry()}
  contextWindow={usage.contextWindow}
  composerFocusToken={composerSignals.focusToken}
  composerEscapeToken={composerSignals.escapeToken}
  micShortcutToken={composerSignals.micToken}
  {completionSource}
  onComposerChange={composerSession.setComposerText}
  onSubmit={() => {
    void runActivePaneAction(composerSession.submit);
  }}
  onAnswerUserQuestion={answerUserQuestion}
  onDismissUserQuestion={dismissUserQuestion}
  onAbort={() => {
    void runActivePaneAction(
      view?.transient?.compaction?.state === "running"
        ? cancelActiveCompaction
        : composerSession.abortActiveRun,
    );
  }}
  onCompact={() => {
    void runActivePaneAction(compactActiveConversation);
  }}
  onOpenSystemPrompt={activePendingConversation || activeConversation
    ? () => runActivePaneAction(openSystemPrompt)
    : undefined}
  onNewConversationInProject={newConversationInProject}
  onOpenFile={openToolFile}
  onOpenTask={openTaskFromNotice}
  {composerView}
  onModelSelectionChange={(next) => {
    void runActivePaneAction(() => setComposerModelSelection(next));
  }}
  onAgentProfileChange={(value) => {
    void runActivePaneAction(() => setComposerAgentProfile(value));
  }}
  onPermissionRuleSetChange={(value) => {
    void runActivePaneAction(() => setComposerPermissionRuleSet(value));
  }}
  onRefreshPermissionRuleSets={() => {
    if (activeProject?.id) {
      void permissionRuleSetCatalog.refresh(activeProject.id);
    }
  }}
  onOpenPermissionSettings={() => void openSettingsPane("general")}
  onOpenCapabilitySettings={(page) => void openSettingsPane(page)}
  onGrantApproval={grantApproval}
  onDenyApproval={denyApproval}
  onAcceptPlanReview={acceptPendingPlanReview}
  onAcceptPlanReviewInNewChat={undefined}
  onRejectPlanReview={rejectPendingPlanReview}
  onRetryResponse={() => {
    void runActivePaneAction(composerSession.retryActiveResponse);
  }}
  onCancelCompaction={() => {
    void runActivePaneAction(cancelPendingCompaction);
  }}
  onContinueFromFailure={(runId) => {
    void runActivePaneAction(() => continueFromFailure(runId));
  }}
  onForcePushQueuedPrompts={forcePushQueuedPrompts}
  onDiscardQueuedPrompt={discardQueuedPrompt}
  onMoveQueuedPromptToComposer={moveQueuedPromptToComposer}
  onNavigateToEntry={agentView.viewedChildId
    ? undefined
    : (entryId, summarize) => {
        void jumpToConversationEntry(entryId, summarize);
      }}
  onEditEntry={agentView.viewedChildId
    ? undefined
    : (entry) => {
        composerSession.editEntry(entry);
      }}
  onForkFromEntry={agentView.viewedChildId
    ? undefined
    : (entryId) => {
        if (store) forkConversation(store, entryId);
      }}
  rewindLocked={historyLocked}
  onOpenHistory={() => {
    transcriptView = "history";
  }}
  {transcriptView}
  onToggleHistory={store?.snapshot ? toggleHistory : undefined}
  messageStep={composerSignals.messageStep}
>
  {#snippet history(controls)}
    {#if store}
      <ConversationHistoryHost
        {store}
        readOnly={Boolean(agentView.viewedChildId)}
        rewindLocked={historyLocked}
        onRewind={(entryId) =>
          void runActivePaneAction(() => rewindFromHistory(entryId))}
        onFork={(entryId) => {
          if (store) forkConversation(store, entryId);
        }}
        onEdit={(entry) => {
          composerSession.editEntry(entry);
          transcriptView = "conversation";
        }}
        onReveal={controls.reveal}
        onClose={() => {
          transcriptView = "conversation";
        }}
      />
    {/if}
  {/snippet}
  {#snippet contextActions(closePopover)}
    <ConversationContextActions
      compaction={compactionSettings.compaction}
      compactionOverridden={compactionSettings.overridden}
      {instructions}
      profile={agentView.viewedProfile}
      disabled={!store?.snapshot || compactionSettings.saving}
      compactionLocked={activeCompactionLocked}
      onEditCompaction={() => {
        closePopover();
        compactionDialogOpen = true;
      }}
      onEditInstructions={() => {
        closePopover();
        instructionsDialogOpen = true;
      }}
    />
  {/snippet}
  {#snippet activity(showLatest, onJumpToBottom)}
    <!-- One row: the profile notice sits beside the activity island. -->
    <div class="flex items-center justify-end gap-1">
      {#if effective?.appliedProfile && store && !agentView.viewedChildId}
        <ProfileUpdateNotice
          conversationId={store.conversationId}
          applied={effective.appliedProfile}
          onApplied={() => store!.refreshConfiguration()}
        />
      {/if}
      {#if agentView.viewedConversationId}
        <ConversationActivityIsland
          bind:open={agentView.activityOpen}
          {active}
          agents={agentView.leadContext?.conversationAgents ?? []}
          activities={agentView.leadContext?.agentActivities ?? {}}
          viewedId={agentView.viewedConversationId}
          commands={backgroundCommands}
          {showLatest}
          {onJumpToBottom}
          onSelectAgent={(id) => agentView.viewAgent(id)}
          onOpenCommand={openCommand}
        />
      {/if}
    </div>
  {/snippet}
</WorkbenchConversationAdapter>

<ConversationSettingsDialogs
  bind:compactionOpen={compactionDialogOpen}
  bind:instructionsOpen={instructionsDialogOpen}
  compaction={compactionSettings.compaction}
  compactionOverridden={compactionSettings.overridden}
  {instructions}
  onSaveCompaction={(value) => compactionSettings.saveCompaction(value)}
  onResetCompaction={() => compactionSettings.saveCompaction(null)}
  onSaveInstructions={async (value) => {
    await store?.configure({ instructions: value });
  }}
/>

<PromptSuggestionTrustDialog projectId={activeProject?.id} {conversationId} />
