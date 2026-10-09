<script lang="ts">
import { emptyCapabilityOverrides } from "@nervekit/contracts/capabilities";
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
import { conversationTranscript } from "$lib/features/conversations/adapters/core-transcript.adapter";
import { updateCapabilities } from "$lib/features/conversations/adapters/core-capabilities.adapter";
import {
  conversationContext,
  projectView,
} from "$lib/features/conversations/adapters/core-context.adapter";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { openTaskTab } from "$lib/features/tasks";
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
let store = $state<ConversationStore>();
let tree = $state<EventTreeNode[]>([]);
let composerText = $state("");
let stopping = $state(false);
let compacting = $state(false);
let editTarget = $state<ConversationEntry>();
$effect(() => {
  const id = conversationId;
  store = undefined;
  tree = [];
  composerText = "";
  editTarget = undefined;
  if (!id) return;
  const retained = retainConversationStore(id);
  store = retained.store;
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
const permissionRuleSets = $derived(
  selectablePermissionRuleSets(
    permissionRuleSetCatalog.summaries(activeProject?.id),
    selectedMode,
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
const contextWindow = $derived(
  context?.contextWindow ??
    settingsState.models.find((m) => modelKey(m) === selectedModelKey)
      ?.contextWindow ??
    0,
);
const activeComposerText = $derived(
  activePendingConversation?.composerText ?? composerText,
);
const composerSuggestions: [] = [];
const sendSuggestion = undefined;
const applySuggestion = undefined;
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
async function submitPrompt() {
  const text = activeComposerText;
  if (!text.trim()) return;
  const pending = activePendingConversation;
  if (pending) {
    if (pending.sending) return;
    pending.sending = true;
    try {
      const snapshot = pending.createdConversationId
        ? await requestConversation("conversation.getSnapshot", {
            conversationId: pending.createdConversationId,
          })
        : await requestConversation("conversation.create", {
            id: createId("conv"),
            projectId: pending.projectId,
            title: pending.title,
            config: pending.config,
          });
      pending.createdConversationId = snapshot.conversation.id;
      await updateCapabilities({
        projectId: pending.projectId,
        conversationId: snapshot.conversation.id,
        layer: "conversation",
        replace: pending.capabilityOverrides ?? emptyCapabilityOverrides(),
      });
      await requestConversation("input.submit", {
        conversationId: snapshot.conversation.id,
        inputId: createId("input"),
        text,
        source: "user",
      });
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
  if (composerText === text) composerText = "";
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
const cancelActiveCompaction = abortActiveRun;
function openToolFile(path: string, line?: number) {
  if (activeProject)
    void openFilePane({ projectId: activeProject.id, path, line });
}
function openTaskFromNotice(id: string) {
  void openTaskTab(id);
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
async function resolve(id: string, resolution: InteractionResolution) {
  await store?.resolve(id, resolution);
}
function answerUserQuestionById(id: string, answer: string) {
  return resolve(id, { kind: "user_input", answers: { answer } });
}
function dismissUserQuestionById(id: string) {
  return resolve(id, { kind: "user_input", answers: { answer: "" } });
}
function grantApproval(
  id: string,
  scope?:
    | "single_call"
    | "always_conversation"
    | "always_project"
    | "always_user",
) {
  return resolve(id, {
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
function denyApproval(id: string) {
  return resolve(id, { kind: "approval", decision: "deny" });
}
async function acceptPendingPlanReview(
  id: string,
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
  await resolve(id, {
    kind: "plan_review",
    decision: "approve",
    feedback: options?.feedback,
  });
}

function rejectPendingPlanReview(id: string) {
  return resolve(id, { kind: "plan_review", decision: "reject" });
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
  if (active && entry && entry.conversationId === conversationId) {
    composerSignals.editEntry = undefined;
    void editConversationEntry(entry);
  }
});
const completeFiles = (q: string) => fileCompletions(activeProject?.id, q);
const completeReferences = (kind: "task" | "pull_request", q: string) =>
  referenceCompletions(activeProject?.id, kind, q);
const teamRunning = $derived(
  store?.snapshot?.children.some((c) => c.status === "running") ?? false,
);
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
  lastRunOutcome={view?.lastRunOutcome}
  transient={view?.transient}
  queuedPrompts={view?.queuedPrompts ?? []}
  recoveryIssues={view?.recoveryIssues ?? []}
  sending={activePendingConversation?.sending ?? view?.sending ?? false}
  {teamRunning}
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
  contextUsage={context?.contextUsage}
  {conversationUsage}
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
  onAcceptPlanReview={(id, options) => acceptPendingPlanReview(id, options)}
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
/>
