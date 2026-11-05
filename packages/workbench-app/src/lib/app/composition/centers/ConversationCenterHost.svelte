<script lang="ts">
import ProfileUpdateNotice from "$lib/features/conversations/views/ProfileUpdateNotice.svelte";
import { projectAgentDefaults } from "$lib/application/agent-configuration/project-agent-defaults.svelte";
import { CreationPreferencesState } from "$lib/features/settings/state/creation-preferences.svelte";
import { compareSubagents } from "$lib/presentation/conversations/subagent-order";
import { untrack } from "svelte";
import { createComposerView } from "$lib/application/composer/composer-view.svelte";
import { activateComposer } from "$lib/application/composer/active-composer.svelte";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestArrow from "@lucide/svelte/icons/git-pull-request-arrow";
import CircleX from "@lucide/svelte/icons/circle-x";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ScanSearch from "@lucide/svelte/icons/scan-search";
import Trash2 from "@lucide/svelte/icons/trash-2";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Sparkles from "@lucide/svelte/icons/sparkles";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { gitContextFingerprint } from "$lib/features/git/state/git-context.svelte";
import {
  promptSuggestionsState,
  refreshPromptSuggestions,
} from "$lib/features/prompt-suggestions";
import PromptSuggestionTrustDialog from "$lib/features/prompt-suggestions/views/PromptSuggestionTrustDialog.svelte";
import type { ComposerSuggestion } from "$lib/features/conversations/views/composer-suggestion";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import type { EventTreeNode } from "@nervekit/contracts/core";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type { ConversationEntry } from "$lib/presentation/view-models/conversation";
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
  openConversationHistory,
} from "$lib/features/conversations/state/composer-signals.svelte";
import { retainConversationStore } from "$lib/features/conversations/state/open-conversation-stores";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import {
  ConversationAgentUsageController,
  type AgentUsageState,
} from "$lib/features/conversations/state/conversation-agent-usage";
import { conversationTranscript } from "$lib/features/conversations/adapters/core-transcript.adapter";

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
import {
  pendingWork as derivePendingWork,
  hasStoppableWork,
  agentProfileLabel,
} from "$lib/features/conversations/agents/agent-team";
import ConversationSettingsDialogs from "$lib/features/conversations/context/ConversationSettingsDialogs.svelte";
import ConversationContextActions from "$lib/features/conversations/context/ConversationContextActions.svelte";
import { ConversationCompactionState } from "$lib/features/conversations/context/conversation-compaction-state.svelte";
import { sessionFields } from "$lib/features/conversations/views/context-session-fields";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import type { PendingWorkItem } from "$lib/presentation/transcript/activity/run-activity";
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
import {
  runActivePaneAction,
  submitPendingPrompt,
} from "./conversation-center/prompt-submission.svelte";
import { createQueuedPromptActions } from "./conversation-center/queued-prompts.svelte";
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
/** The tab's conversation (the lead of its sub-agents). */
let leadStore = $state<ConversationStore>();
/** A sub-agent shown in place of the lead's transcript, if any. */
let viewedChildId = $state<string>();
let childStore = $state<ConversationStore>();
let releaseChild: (() => void) | undefined;
let activityOpen = $state<"agents" | "commands" | null>(null);
/** Everything below acts on the conversation being viewed. */
const store = $derived(viewedChildId ? childStore : leadStore);
let tree = $state<EventTreeNode[]>([]);
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
let editText = $state("");
let retryingResponse = $state(false);
let editTarget = $state<ConversationEntry>();
/** Shows a sub-agent in the main view; the lead id (or none) returns. */
function viewAgent(id: string | undefined) {
  releaseChild?.();
  releaseChild = undefined;
  childStore = undefined;
  viewedChildId = undefined;
  activityOpen = null;
  editTarget = undefined;
  if (!id || id === conversationId) return;
  const retained = retainConversationStore(id);
  releaseChild = retained.release;
  childStore = retained.store;
  viewedChildId = id;
  void retained.ready.catch((e) => notify.error(String(e)));
}
$effect(() => () => untrack(() => viewAgent(undefined)));
$effect(() => {
  if (viewedChildId && childStore?.deleted) viewAgent(undefined);
});
$effect(() => {
  const id = conversationId;
  leadStore = undefined;
  untrack(() => viewAgent(undefined));
  tree = [];
  editTarget = undefined;
  if (!id) return;
  const retained = retainConversationStore(id);
  leadStore = retained.store;
  void retained.ready.catch((e) => notify.error(String(e)));
  return retained.release;
});
const transcript = $derived(
  store?.snapshot
    ? conversationTranscript({
        snapshot: store.snapshot,
        events: store.events,
        liveBlocks: store.liveBlocks,
        toolOutput: store.toolOutput,
        tree,
      })
    : undefined,
);
const view = $derived(
  store?.snapshot && transcript
    ? {
        ...transcript,
        stopping:
          Boolean(store?.stopping) ||
          Boolean(transcript.transient?.compaction?.stopping),
        retryingResponse,
        responseRevision: store.responseRevision,
        transient: transcript.transient,
      }
    : undefined,
);
const context = $derived(
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
          conversationId: viewedChildId ?? conversationId ?? "",
          readOnly: !!viewedChildId,
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
/** Profiles the selector offers; a viewed sub-agent shows only its own, read-only. */
const composerProfiles = $derived(
  viewedChildId
    ? [
        {
          name: selectedAgentProfile,
          label: selectedAgentProfile,
          source: resolvedProfiles.find(
            (profile) => profile.name === selectedAgentProfile,
          )?.source,
        },
      ]
    : leadAgentProfiles(resolvedProfiles).map((profile) => ({
        name: profile.name,
        label: profile.label,
        whenToUse: profile.whenToUse,
        source: profile.source,
      })),
);
const lockedFields = $derived({
  ...composerView.locked,
  by: composerView.appliedProfile,
});
const activeCompactionLocked = $derived(Boolean(lockedFields.compaction));
const composerOverrides = $derived(composerView.overrides);
const settingsDiffers = $derived({
  model:
    !viewedChildId &&
    (composerOverrides.model !== undefined ||
      composerOverrides.reasoningLevel !== undefined),
  permission:
    !viewedChildId && composerOverrides.permissionRuleSetId !== undefined,
});
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
/** Sub-agents run read-only or autonomous; nothing in between. */
const SUBAGENT_RULE_SETS = new Set(["read_only", "autonomous"]);
const permissionRuleSets = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
  ).filter((rules) => !viewedChildId || SUBAGENT_RULE_SETS.has(rules.id)),
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
let usageOpen = $state(false);
let agentUsageState = $state<AgentUsageState>({ loading: false });
const agentUsageController = new ConversationAgentUsageController({
  fetch: (conversationId) =>
    requestConversation("conversation.getUsage", { conversationId }),
  publish: (state) => {
    agentUsageState = state;
  },
});
$effect(() => {
  // All-time usage also drives the badge's cache warning, so fetch it while the
  // conversation is active; poll only while the details are open.
  agentUsageController.configure(
    store?.conversationId,
    active && !!store?.connected,
    usageOpen,
  );
});
// Each new response changes recorded usage.
$effect(() => {
  void conversationUsage.responseCount;
  untrack(() => agentUsageController.invalidate());
});
$effect(() => () => agentUsageController.dispose());
const contextWindow = $derived(
  context?.contextWindow ??
    settingsState.models.find((m) => modelKey(m) === selectedModelKey)
      ?.contextWindow ??
    0,
);
const activeComposerText = $derived(
  editTarget
    ? editText
    : promptDraftTarget
      ? drafts.getPrompt(promptDraftTarget)
      : "",
);
const builtinSuggestionIcons = {
  "commit-changes": GitCommitHorizontal,
  "commit-on-feature-branch": GitBranchPlus,
  "create-pull-request": GitPullRequest,
  "update-pull-request": GitPullRequestArrow,
  "fix-failing-checks": CircleX,
  "push-commits": ArrowUp,
  "pull-upstream": ArrowDown,
  "review-changes": ScanSearch,
  "cleanup-merged-branch": Trash2,
  "continue-after-failure": RotateCcw,
} as const;
const composerSuggestions = $derived.by<ComposerSuggestion[]>(() =>
  promptSuggestionsState.suggestions.map((suggestion) => ({
    id: `prompt:${suggestion.id}`,
    label: suggestion.label,
    prompt: suggestion.prompt,
    description: suggestion.description,
    context: suggestion.context,
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
// Suggestions read the cached open PR, so a PR/check change can add or drop
// chips without any git or conversation change. Debounced: sync bursts.
let prChangeTick = $state(0);
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !active) return;
  const projectId = activeProject?.id;
  if (!projectId) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = onEvent("github.pr.changed", (event) => {
    if (event.data?.projectId !== projectId) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      prChangeTick += 1;
    }, 1000);
  });
  return () => {
    stop();
    clearTimeout(timer);
  };
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !active || !activeProject?.id)
    return;
  void promptSuggestionRefreshKey;
  void prChangeTick;
  void store?.snapshot?.config;
  void store?.snapshot?.conversation.status;
  void store?.snapshot?.conversation.title;
  void refreshPromptSuggestions(activeProject.id, { conversationId });
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
    submitPrompt(suggestion.prompt, { clearComposer: false }),
  );
}
function setPaneComposerText(text: string) {
  if (editTarget) editText = text;
  else if (promptDraftTarget) drafts.setPrompt(promptDraftTarget, text);
}
async function submitPrompt(
  text = activeComposerText,
  options: { clearComposer?: boolean } = {},
) {
  if (!text.trim() || viewedChildId) return;
  const pending = activePendingConversation;
  if (pending) {
    await submitPendingPrompt({
      pending,
      text,
      inherited: composerView.inherited,
      drafts,
      clearComposer: options.clearComposer !== false,
    });
    return;
  }
  const submittingStore = store;
  const submittingEdit = editTarget;
  const submittingTarget = promptDraftTarget;
  if (!submittingStore) return;
  if (submittingEdit)
    await submittingStore.selectHead(submittingEdit.parentEntryId ?? null);
  await submittingStore.submit(text);
  if (!submittingEdit && submittingTarget && options.clearComposer !== false)
    drafts.clearPromptIfUnchanged(submittingTarget, text);
  if (editTarget === submittingEdit && (!submittingEdit || editText === text))
    editTarget = undefined;
}
async function abortActiveRun() {
  await store?.control("stop");
}
async function retryActiveResponse() {
  if (retryingResponse) return;
  retryingResponse = true;
  try {
    await store?.retryResponse();
  } finally {
    retryingResponse = false;
  }
}
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
const cancelActiveCompaction = abortActiveRun;
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
  resetComposerPermission,
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
  setComposerText: setPaneComposerText,
});
const jumpToConversationEntry: (
  id: string | undefined,
  summarize?: boolean,
) => Promise<void> = async (id) => {
  await store?.selectHead(id ?? null);
};
async function editConversationEntry(entry: ConversationEntry) {
  editTarget = entry;
  editText = entry.text;
  focusComposer();
}
$effect(() => {
  const entry = composerSignals.editEntry;
  if (
    active &&
    entry &&
    entry.conversationId === conversationId &&
    !viewedChildId
  ) {
    composerSignals.editEntry = undefined;
    void editConversationEntry(entry);
  }
});
const completionProjectId = $derived(activeProject?.id);
const completionConversationId = $derived(viewedChildId ?? conversationId);
// Construction is inert; only an active editor query acquires server data.
const completionSource = $derived(
  active && completionProjectId
    ? composerReferenceSource(completionProjectId, completionConversationId)
    : undefined,
);
/** The lead's context drives the agents tree in both lead and sub-agent views. */
const leadContext = $derived(
  !viewedChildId
    ? context
    : leadStore?.snapshot
      ? conversationContext(
          leadStore.snapshot,
          leadStore.events,
          settingsState.models,
        )
      : undefined,
);
const viewedConversationId = $derived(
  viewedChildId ?? leadStore?.snapshot?.conversation.id,
);
const backgroundCommands = $derived(store?.snapshot?.asyncBash ?? []);
const pendingWork = $derived(
  store?.snapshot
    ? derivePendingWork({
        children: store.snapshot.children,
        asyncBash: store.snapshot.asyncBash,
      })
    : [],
);
function openPendingWork(item: PendingWorkItem) {
  if (item.kind === "agent") viewAgent(item.id);
  else activityOpen = "commands";
}
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
const viewedProfile = $derived.by(() => {
  if (!viewedChildId) return undefined;
  const agent = leadContext?.conversationAgents.find(
    (candidate) => candidate.id === viewedChildId,
  );
  return agent ? agentProfileLabel(agent) : undefined;
});
const composerOverlay = $derived(
  viewedChildId
    ? {
        message: "Sub-agents take prompts only from their lead.",
        actionLabel: "Back to lead",
        onAction: () => viewAgent(undefined),
      }
    : undefined,
);
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
</script>

<WorkbenchConversationAdapter
  {active}
  {pendingWork}
  onOpenPendingWork={openPendingWork}
  subagents={{
    list: () =>
      [...(leadStore?.snapshot?.children ?? [])]
        .sort(compareSubagents)
        .map((child) => ({
          id: child.id,
          name: child.title,
          status: child.status,
        })),
    open: (id) => viewAgent(id),
  }}
  editorOverlay={composerOverlay}
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
  composerText={activeComposerText}
  composerSuggestions={viewedChildId ? [] : composerSuggestions}
  onSendSuggestion={sendSuggestion}
  onDraftSuggestion={applySuggestion}
  models={usableModels}
  {selectedModelKey}
  thinkingLevel={selectedThinkingLevel}
  planReviewModels={usableModels}
  {planReviewModelKey}
  {planReviewThinkingLevel}
  agentProfile={selectedAgentProfile}
  agentProfiles={composerProfiles}
  {lockedFields}
  {settingsDiffers}
  profileDisabled={Boolean(viewedChildId)}
  permissionRuleSetId={selectedPermissionRuleSetId}
  {permissionRuleSets}
  {permissionRuleSetsLoading}
  {permissionRuleSetsError}
  {slashCompletions}
  contextUsage={context?.contextUsage}
  {conversationUsage}
  agentUsage={agentUsageState.usage}
  agentUsageLoading={agentUsageState.loading}
  agentUsageError={agentUsageState.error}
  onUsageOpenChange={(open) => {
    usageOpen = open;
  }}
  onUsageRetry={() => agentUsageController.retry()}
  {contextWindow}
  composerFocusToken={composerSignals.focusToken}
  composerEscapeToken={composerSignals.escapeToken}
  micShortcutToken={composerSignals.micToken}
  {completionSource}
  onComposerChange={setPaneComposerText}
  onSubmit={() => {
    void runActivePaneAction(submitPrompt);
  }}
  onAnswerUserQuestion={answerUserQuestion}
  onDismissUserQuestion={dismissUserQuestion}
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
  onResetPermission={() => void runActivePaneAction(resetComposerPermission)}
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
    void runActivePaneAction(retryActiveResponse);
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
  onNavigateToEntry={(entryId, summarize) => {
    void jumpToConversationEntry(entryId, summarize);
  }}
  onEditEntry={(entry) => {
    void editConversationEntry(entry);
  }}
  onOpenHistory={() => {
    void runActivePaneAction(openConversationHistory);
  }}
>
  {#snippet contextActions(closePopover)}
    <ConversationContextActions
      compaction={compactionSettings.compaction}
      compactionOverridden={compactionSettings.overridden}
      {instructions}
      profile={viewedProfile}
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
    {#if effective?.appliedProfile && store && !viewedChildId}
      <ProfileUpdateNotice
        conversationId={store.conversationId}
        applied={effective.appliedProfile}
        onApplied={() => store!.refreshConfiguration()}
      />
    {/if}
    {#if viewedConversationId}
      <ConversationActivityIsland
        bind:open={activityOpen}
        {active}
        agents={leadContext?.conversationAgents ?? []}
        activities={leadContext?.agentActivities ?? {}}
        viewedId={viewedConversationId}
        commands={backgroundCommands}
        {showLatest}
        {onJumpToBottom}
        onSelectAgent={(id) => viewAgent(id)}
        onOpenCommand={openCommand}
      />
    {/if}
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
