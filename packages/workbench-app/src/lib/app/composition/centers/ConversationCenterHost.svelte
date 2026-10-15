<script lang="ts">
import { untrack } from "svelte";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
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
import { submitPendingConversation } from "$lib/app/composition/conversations/submit-pending-conversation";
import { captureSystemPromptPreview } from "$lib/app/composition/conversations/system-prompt-preview";
import { openSystemPromptPane } from "$lib/features/conversations/state/system-prompt-pane.svelte";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { createId } from "@nervekit/contracts";
import type {
  ConversationConfig,
  InteractionResolution,
  EventTreeNode,
} from "@nervekit/contracts/core";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type {
  QueuedPromptRecord,
  ConversationEntry,
  PlanReviewResolveOptions,
} from "$lib/presentation/view-models/conversation";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { pendingConversations } from "$lib/application/workspace/pending-conversations.svelte";
import {
  replaceOpenCenterTabs,
  selectCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import type { CenterTabIdentity } from "$lib/application/workspace";
import { newConversationInProject } from "$lib/application/workspace/workspace-actions.svelte";
import { clampThinkingLevelForModel } from "$lib/presentation/state/thinking-levels";
import {
  modelKey,
  parseModelKey,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import {
  openSettingsPane,
  rememberLastAgentSelection,
} from "$lib/application/settings";
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
import { updateCapabilities } from "$lib/features/conversations/adapters/core-capabilities.adapter";
import {
  conversationContext,
  projectView,
} from "$lib/features/conversations/adapters/core-context.adapter";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import ConversationActivityIsland from "$lib/features/conversations/agents/ConversationActivityIsland.svelte";
import { openAsyncBashTab } from "$lib/features/conversations";
import {
  pendingWork as derivePendingWork,
  subagentProfileLabel,
} from "$lib/features/conversations/agents/agent-team";
import ConversationSettingsDialogs from "$lib/features/conversations/context/ConversationSettingsDialogs.svelte";
import ConversationContextActions from "$lib/features/conversations/context/ConversationContextActions.svelte";
import { ConversationHarnessState } from "$lib/features/conversations/context/conversation-harness-state.svelte";
import { sessionFields } from "$lib/features/conversations/views/context-session-fields";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import type { PendingWorkItem } from "$lib/presentation/transcript/activity/run-activity";
import type { AsyncBash } from "@nervekit/contracts/core";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { openLaunchTab } from "$lib/features/launches";
import {
  fileCompletions,
  referenceCompletions,
} from "$lib/app/composition/conversations/composer-reference-completions";
import { notify } from "$lib/application/notifications/notify.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import {
  effectivePermissionRuleSetId,
  selectablePermissionRuleSets,
} from "$lib/domain/permissions/rule-set-options";
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
let composerText = $state("");
let stopping = $state(false);
let compacting = $state(false);
let editTarget = $state<ConversationEntry>();
/** Shows a sub-agent in the main view; the lead id (or none) returns. */
function viewAgent(id: string | undefined) {
  releaseChild?.();
  releaseChild = undefined;
  childStore = undefined;
  viewedChildId = undefined;
  activityOpen = null;
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
  composerText = untrack(() => {
    const draft = composerSignals.createdConversationDraft;
    if (!draft || draft.conversationId !== id) return "";
    composerSignals.createdConversationDraft = undefined;
    return draft.text;
  });
  editTarget = undefined;
  if (!id) return;
  const retained = retainConversationStore(id);
  leadStore = retained.store;
  void retained.ready.catch((e) => notify.error(String(e)));
  return retained.release;
});
const view = $derived(
  store?.snapshot
    ? {
        ...conversationTranscript({
          snapshot: store.snapshot,
          events: store.events,
          liveBlocks: store.liveBlocks,
          toolOutput: store.toolOutput,
          tree,
        }),
        stopping,
        transient: compacting
          ? { compaction: { id: "compact", state: "running" as const } }
          : undefined,
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
const selectedModelKey = $derived(
  activePendingConversation?.selectedModelKey ??
    (store?.snapshot ? modelKey(store.snapshot.config.model) : ""),
);
const selectedThinkingLevel = $derived(
  activePendingConversation?.thinkingLevel ??
    store?.snapshot?.config.reasoningLevel ??
    "off",
);
const selectedMode = $derived(
  activePendingConversation?.mode ?? store?.snapshot?.config.mode ?? "coding",
);
const selectedPermissionRuleSetId = $derived(
  effectivePermissionRuleSetId(
    activePendingConversation?.permissionRuleSetId ??
      store?.snapshot?.config.permissionRuleSetId ??
      "autonomous",
    selectedMode,
  ),
);
const usableModels = $derived(
  scopedUsableModelOptions(
    settingsState.models,
    settingsState.authProviders,
    settingsState.settingsDraft?.scopedModels,
  ),
);
const planReviewModelKey = $derived(selectedModelKey);
const planReviewThinkingLevel = $derived(selectedThinkingLevel);
/** Sub-agents run read-only or autonomous; nothing in between. */
const SUBAGENT_RULE_SETS = new Set(["read_only", "autonomous"]);
const permissionRuleSets = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
    selectedMode,
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
  agentUsageController.configure(
    store?.conversationId,
    usageOpen && active && !!store?.connected,
  );
});
$effect(() => () => agentUsageController.dispose());
const contextWindow = $derived(
  context?.contextWindow ??
    settingsState.models.find((m) => modelKey(m) === selectedModelKey)
      ?.contextWindow ??
    0,
);
const activeComposerText = $derived(
  activePendingConversation?.composerText ?? composerText,
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
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !active || !activeProject?.id)
    return;
  void promptSuggestionRefreshKey;
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
  if (activePendingConversation) activePendingConversation.composerText = text;
  else composerText = text;
}
async function runActivePaneAction(action: () => unknown | Promise<unknown>) {
  try {
    await action();
  } catch (e) {
    notify.error(e instanceof Error ? e.message : String(e));
  }
}
async function configure(
  patch: Partial<Omit<ConversationConfig, "conversationId">>,
) {
  const p = activePendingConversation;
  if (p) {
    Object.assign(p.config, patch);
    p.selectedModelKey = modelKey(p.config.model);
    p.thinkingLevel = p.config.reasoningLevel;
    p.mode = p.config.mode;
    p.permissionRuleSetId = p.config.permissionRuleSetId;
  } else await store?.configure(patch);
}
async function submitPrompt(
  text = activeComposerText,
  options: { clearComposer?: boolean } = {},
) {
  if (!text.trim() || viewedChildId) return;
  const pending = activePendingConversation;
  if (pending) {
    if (pending.sending) return;
    pending.sending = true;
    try {
      const snapshot = await submitPendingConversation(pending, text, {
        create: (input) =>
          requestConversation("conversation.create", {
            id: createId("conv"),
            ...input,
          }),
        getSnapshot: (conversationId) =>
          requestConversation("conversation.getSnapshot", { conversationId }),
        configure: (conversationId, patch) =>
          requestConversation("conversation.configure", {
            conversationId,
            patch,
          }),
        saveCapabilities: updateCapabilities,
        saveProfiles: (input) =>
          requestWorkbench("subagentProfiles.replaceConversation", input),
        submit: (conversationId, prompt) =>
          requestConversation("input.submit", {
            conversationId,
            inputId: createId("input"),
            text: prompt,
            source: "user",
          }),
      });
      if (options.clearComposer === false)
        composerSignals.createdConversationDraft = {
          conversationId: snapshot.conversation.id,
          text: pending.composerText,
        };
      workspaceState.conversations = [
        ...workspaceState.conversations,
        {
          ...snapshot.conversation,
          childCount: 0,
          mode: snapshot.config.mode,
          model: snapshot.config.model,
          permissionRuleSetId: snapshot.config.permissionRuleSetId,
        },
      ];
      replaceOpenCenterTabs(
        workspaceState.openCenterTabs.map((t) =>
          t.kind === "pending-conversation" && t.id === pending.id
            ? { kind: "conversation", id: snapshot.conversation.id }
            : t,
        ),
      );
      pendingConversations.delete(pending.id);
      await selectCenterTab({
        kind: "conversation",
        id: snapshot.conversation.id,
      });
    } catch (e) {
      pending.error = String(e);
      throw e;
    } finally {
      pending.sending = false;
    }
    return;
  }
  if (!store) return;
  if (editTarget) await store.selectHead(editTarget.parentEntryId ?? null);
  await store.submit(text);
  if (options.clearComposer !== false && composerText === text)
    composerText = "";
  editTarget = undefined;
}
async function abortActiveRun() {
  stopping = true;
  try {
    await store?.control("stop");
  } finally {
    stopping = false;
  }
}
async function compactActiveConversation() {
  compacting = true;
  try {
    await store?.control("compact");
  } finally {
    compacting = false;
  }
}
let openingSystemPrompt = false;
async function openSystemPrompt() {
  if (openingSystemPrompt) return;
  const target = captureSystemPromptPreview({
    pending: activePendingConversation,
    conversation: store?.snapshot?.conversation,
  });
  if (!target) return;
  openingSystemPrompt = true;
  try {
    const { systemPrompt } = await requestConversation(
      "conversation.previewSystemPrompt",
      target.params,
    );
    await openSystemPromptPane({
      projectId: target.projectId,
      sourceId: target.sourceId,
      text: systemPrompt,
    });
  } finally {
    openingSystemPrompt = false;
  }
}
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
function setComposerModel(key: string) {
  const model = parseModelKey(key);
  if (model) {
    const reasoningLevel = clampThinkingLevelForModel(
      selectedThinkingLevel,
      settingsState.models.find((candidate) => modelKey(candidate) === key),
    );
    rememberLastAgentSelection({ model, thinkingLevel: reasoningLevel });
    return configure({ model, reasoningLevel });
  }
}
function setComposerThinkingLevel(value: ConversationConfig["reasoningLevel"]) {
  const reasoningLevel = clampThinkingLevelForModel(
    value,
    settingsState.models.find(
      (candidate) => modelKey(candidate) === selectedModelKey,
    ),
  );
  rememberLastAgentSelection({ thinkingLevel: reasoningLevel });
  return configure({ reasoningLevel });
}
function setComposerMode(value: ConversationConfig["mode"]) {
  rememberLastAgentSelection({ mode: value });
  return configure({ mode: value });
}
function setComposerPermissionRuleSet(value: string) {
  rememberLastAgentSelection({ permissionRuleSetId: value });
  return configure({ permissionRuleSetId: value });
}
async function resolve(toolCallId: string, resolution: InteractionResolution) {
  await store?.resolve(toolCallId, resolution);
}
function answerUserQuestion(toolCallId: string, answer: string) {
  return resolve(toolCallId, { kind: "user_input", answers: { answer } });
}
function dismissUserQuestion(toolCallId: string) {
  return resolve(toolCallId, {
    kind: "user_input",
    answers: {},
    dismissed: true,
  });
}
function grantApproval(
  toolCallId: string,
  scope?:
    | "single_call"
    | "always_conversation"
    | "always_project"
    | "always_user",
) {
  return resolve(toolCallId, {
    kind: "approval",
    decision: "approve",
    persistScope:
      scope === "always_conversation"
        ? "conversation"
        : scope === "always_project"
          ? "project"
          : scope === "always_user"
            ? "user"
            : undefined,
  });
}
function denyApproval(toolCallId: string) {
  return resolve(toolCallId, { kind: "approval", decision: "deny" });
}
async function acceptPendingPlanReview(
  toolCallId: string,
  options?: PlanReviewResolveOptions,
) {
  if (options?.compactBeforeImplementation)
    throw new Error(
      "Compacting a pending plan is not supported by the conversation core",
    );
  await configure({
    mode: "coding",
    ...(options?.implementationModel
      ? { model: options.implementationModel }
      : {}),
    ...(options?.implementationThinkingLevel
      ? { reasoningLevel: options.implementationThinkingLevel }
      : {}),
  });
  await resolve(toolCallId, {
    kind: "plan_review",
    decision: "approve",
    feedback: options?.feedback,
  });
}

function rejectPendingPlanReview(toolCallId: string) {
  return resolve(toolCallId, { kind: "plan_review", decision: "reject" });
}
const continueFromFailure: (runId: string) => Promise<null> | undefined = () =>
  store?.control("continue");
function forcePushQueuedPrompts() {
  return store?.control("forcePush").then(() => undefined);
}
function discardQueuedPrompt(prompt: QueuedPromptRecord) {
  return store?.cancelInput(prompt.id).then(() => undefined);
}
async function moveQueuedPromptToComposer(prompt: QueuedPromptRecord) {
  const text = await store?.moveInputToComposer(prompt.id);
  if (text !== undefined) {
    setPaneComposerText(text);
    focusComposer();
  }
}
const jumpToConversationEntry: (
  id: string | undefined,
  summarize?: boolean,
) => Promise<void> = async (id) => {
  await store?.selectHead(id ?? null);
};
async function editConversationEntry(entry: ConversationEntry) {
  editTarget = entry;
  setPaneComposerText(entry.text);
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
const completeFiles = (q: string) => fileCompletions(activeProject?.id, q);
const completeReferences = (kind: "launch" | "pull_request", q: string) =>
  referenceCompletions(activeProject?.id, kind, q);
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
const harness = new ConversationHarnessState();
$effect(() =>
  harness.follow(activeProject?.id, store?.snapshot?.conversation.id),
);
$effect(() => harness.observe());
let compactionDialogOpen = $state(false);
let instructionsDialogOpen = $state(false);
const instructions = $derived(store?.snapshot?.config.instructions ?? null);
const viewedProfile = $derived.by(() => {
  if (!viewedChildId) return undefined;
  const agent = leadContext?.conversationAgents.find(
    (candidate) => candidate.id === viewedChildId,
  );
  return agent ? subagentProfileLabel(agent) : undefined;
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
const teamRunning = $derived(
  store?.snapshot?.children.some((c) => c.status === "running") ?? false,
);
</script>

<WorkbenchConversationAdapter
  {active}
  {pendingWork}
  onOpenPendingWork={openPendingWork}
  subagents={{
    list: () =>
      (leadStore?.snapshot?.children ?? []).map((child) => ({
        id: child.id,
        name: child.title,
        status: child.status,
      })),
    open: (id) => viewAgent(id),
  }}
  editorOverlay={composerOverlay}
  modeHidden={Boolean(viewedChildId)}
  {session}
  {activeProject}
  {activeConversation}
  {activeAgent}
  {activePendingConversation}
  {pendingConversationActive}
  conversationLoading={Boolean(
    conversationId && !store?.snapshot && !store?.error,
  )}
  homeDir={workspaceState.status?.storage.userHome}
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
  {teamRunning}
  stopping={view?.stopping ?? false}
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
  mode={selectedMode}
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
  fileCompletions={active ? completeFiles : undefined}
  referenceCompletions={active ? completeReferences : undefined}
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
  onOpenCapabilitySettings={(page) => void openSettingsPane(page)}
  onGrantApproval={grantApproval}
  onDenyApproval={denyApproval}
  onAcceptPlanReview={acceptPendingPlanReview}
  onAcceptPlanReviewInNewChat={undefined}
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
>
  {#snippet contextActions(closePopover)}
    <ConversationContextActions
      harness={harness.result}
      {instructions}
      profile={viewedProfile}
      disabled={!store?.snapshot || harness.saving}
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
  compaction={harness.result?.compaction.effective}
  compactionOverridden={harness.result?.compaction.source === "conversation"}
  {instructions}
  onSaveCompaction={(value) => harness.saveCompaction(value)}
  onResetCompaction={() => harness.saveCompaction(null)}
  onSaveInstructions={async (value) => {
    await store?.configure({ instructions: value });
  }}
/>

<PromptSuggestionTrustDialog projectId={activeProject?.id} {conversationId} />
