<script lang="ts">
import { tick, untrack } from "svelte";
import { DEFAULT_AGENT_PROFILE } from "@nervekit/contracts/agent-profiles";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { notify } from "$lib/application/notifications/notify.svelte";
import type { WorkbenchConversationAdapterProps } from "$lib/features/conversations/views/workbench-conversation-adapter-props";
import {
  activeRunStreamingText,
  buildActiveRunTimeline,
  CommittedTimelineProjection,
  currentTodosForAgent,
  selectVisibleCommitted,
} from "$lib/presentation/state";
import { ConversationPane } from "$lib/presentation/conversations";
import { outcomeUnknownToolCallIds } from "$lib/presentation/tools/views/tool-activity-state";
import { setConversationUiCapabilities } from "$lib/presentation/context.svelte";
import WorkbenchComposerAdapter from "./WorkbenchComposerAdapter.svelte";
import { workbenchConversationUiCapabilities } from "./conversation-capabilities.svelte";
import ConversationWelcome from "$lib/features/conversations/views/ConversationWelcome.svelte";
import { openInlineMermaidPane } from "$lib/features/filesystem";
import type { MermaidMarkdownBlock } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";

import { transcriptMenu } from "$lib/features/conversations/views/conversation-menus";
import { quoteMarkdown } from "$lib/features/conversations/views/conversation-menu-model";
import { focusComposer, toggleComposerMic } from "$lib/features/conversations";
import {
  voiceInputSession,
  type VoiceInputTarget,
} from "$lib/features/conversations/audio/voice-input-session.svelte";
import type {
  TranscriptMenuTarget,
  TranscriptSelection,
} from "$lib/presentation/conversations";
import { createConversationRenderProjection } from "$lib/features/conversations/state/conversation-render-projection.svelte";

import type { ComposerView } from "$lib/application/composer/composer-view.svelte";

let {
  composerView,
  activity,
  pendingWork = [],
  onOpenPendingWork,
  subagents,
  editorOverlay,
  session,
  contextActions,
  activeProject,
  activeConversation,
  activeAgent,
  activePendingConversation,
  pendingConversationActive = false,
  conversationLoading = false,
  approvals = [],
  pendingUserQuestions = [],
  pendingPlanReviews = [],
  active = true,
  entries = [],
  optimisticMessages = [],
  toolCalls = [],
  treeNodes = [],
  activeRun,
  lastRunOutcome,
  transient,
  queuedPrompts = [],
  recoveryIssues = [],
  sending = false,
  teamRunning = false,
  stopping: stoppingRequested = false,
  responseRevision = 0,
  retryingResponse = false,
  composerText = "",
  models = [],
  selectedModelKey = "",
  planReviewModels = [],
  planReviewModelKey = "",
  planReviewThinkingLevel = "off",
  contextUsage,
  conversationUsage,
  agentUsage,
  agentUsageLoading,
  agentUsageError,
  contextWindow = 0,
  composerFocusToken = 0,
  composerEscapeToken = 0,
  micShortcutToken = 0,
  thinkingLevel = "off",
  agentProfile = DEFAULT_AGENT_PROFILE,
  agentProfiles = [],
  lockedFields,
  settingsDiffers,
  profileDisabled = false,
  permissionRuleSetId = "autonomous",
  permissionRuleSets = [],
  permissionRuleSetsLoading = false,
  permissionRuleSetsError,
  slashCompletions = [],
  completionSource,
  composerSuggestions = [],
  onSendSuggestion,
  onDraftSuggestion,
  onComposerChange,
  onSubmit,
  onAnswerUserQuestion,
  onDismissUserQuestion,
  onAbort,
  onCompact,
  onUsageOpenChange,
  onUsageRetry,
  onOpenSystemPrompt,
  onNewConversationInProject,
  onOpenFile,
  onOpenTask,
  onModelSelectionChange,
  onResetPermission,
  onAgentProfileChange,
  onPermissionRuleSetChange,
  onRefreshPermissionRuleSets,
  onOpenPermissionSettings,
  onOpenCapabilitySettings,
  onGrantApproval,
  onDenyApproval,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
  onContinueFromFailure,
  onCancelCompaction,
  onRetryResponse,
  onForcePushQueuedPrompts,
  onDiscardQueuedPrompt,
  onMoveQueuedPromptToComposer,
  onNavigateToEntry,
  onEditEntry,
  onOpenHistory,
}: WorkbenchConversationAdapterProps & {
  composerView?: ComposerView;
} = $props();

setConversationUiCapabilities(
  workbenchConversationUiCapabilities({
    list: () => subagents?.list() ?? [],
    open: (id) => subagents?.open(id),
  }),
);

const composerTodos = $derived(
  currentTodosForAgent(toolCalls, activeAgent?.id),
);
const conversationOpen = $derived(
  Boolean(activeConversation || pendingConversationActive),
);
const activeProjectLabel = $derived(activeProject?.name);
const scrollConversationId = $derived(
  activeConversation?.id ??
    (pendingConversationActive
      ? (activePendingConversation?.id ?? "pending")
      : undefined),
);

function transcriptRenderInputs() {
  return {
    entries,
    optimisticMessages,
    toolCalls,
    activeRun,
    transient,
    queuedPrompts,
    sending,
    approvals,
    pendingUserQuestions,
    pendingPlanReviews,
  };
}

// Protocol reducers and composer state remain immediate. Only the visual
// transcript projection is coalesced, so a burst produces one child render per
// frame without delaying event cursors, approvals, or harness execution.
const renderProjection = createConversationRenderProjection({
  initialScope: untrack(() => scrollConversationId),
  initialActive: untrack(() => active),
  initialValue: untrack(transcriptRenderInputs),
});
$effect(() => {
  renderProjection.update(
    scrollConversationId,
    active,
    transcriptRenderInputs(),
  );
});
$effect(() => () => renderProjection.destroy());
const rendered = $derived(renderProjection.current);

// Keep the durable projection outside the reactive derivation. `rendered` is
// replaced for each visual commit, while these source arrays retain identity
// during pure live streaming.
const committedProjection = new CommittedTimelineProjection();
const committed = $derived.by(() =>
  committedProjection.project({
    entries: rendered.entries,
    optimisticMessages: rendered.optimisticMessages,
    toolCalls: rendered.toolCalls,
  }),
);
const liveItems = $derived.by(() =>
  buildActiveRunTimeline(
    rendered.activeRun,
    rendered.transient,
    committed.context,
  ),
);
const visibleCommitted = $derived(
  selectVisibleCommitted(
    committed.items,
    rendered.activeRun,
    rendered.transient,
    committed.context,
  ),
);
const timeline = $derived({ prefix: visibleCommitted, tail: liveItems });
const compacting = $derived(transient?.compaction?.state === "running");
const outcomeUnknownIds = $derived(outcomeUnknownToolCallIds(recoveryIssues));
const stopping = $derived(
  stoppingRequested || activeRun?.status === "aborting",
);
const streamingText = $derived(activeRunStreamingText(rendered.activeRun));
const treeEntriesById = $derived(
  new Map(treeNodes.map((node) => [node.entry.id, node.entry])),
);

async function copyText(text: string, label = "message") {
  try {
    await writeClipboardText(text);
    notify.success(`Copied ${label}`);
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

function quoteInComposer(text: string) {
  const quoted = quoteMarkdown(text);
  if (!quoted) return;
  const existing = composerText.trimEnd();
  const prefix = existing ? `${existing}\n\n` : "";
  onComposerChange?.(`${prefix}${quoted}\n\n`);
  focusComposer();
}

async function quoteAndDictate(text: string) {
  quoteInComposer(text);
  // Let the editor apply the quote (caret moves after it) before dictation
  // places its chip at the caret.
  await tick();
  const target: VoiceInputTarget | undefined = activeConversation
    ? { kind: "conversation", id: activeConversation.id }
    : activePendingConversation
      ? { kind: "pending-conversation", id: activePendingConversation.id }
      : undefined;
  if (!target || !active) return;
  const listening =
    voiceInputSession.isTargetActive(target) &&
    (voiceInputSession.recording || voiceInputSession.transcribing);
  if (!listening) toggleComposerMic();
}

const selectionActions = $derived({
  quote: quoteInComposer,
  quoteAndDictate: voiceInputSession.isSupported()
    ? quoteAndDictate
    : undefined,
});

function openAssistantMermaid(
  block: MermaidMarkdownBlock,
  messageKey: string,
): void {
  if (!activeProject) return;
  const conversationKey =
    activeConversation?.id ?? activePendingConversation?.id ?? "pending";
  void openInlineMermaidPane({
    projectId: activeProject.id,
    sourceKey: `${conversationKey}:${messageKey}`,
    name: "Assistant diagram",
    block,
  });
}

function menuForTranscript(
  target: TranscriptMenuTarget,
  selection?: TranscriptSelection,
) {
  return transcriptMenu(target, selection, {
    treeEntriesById,
    copyText,
    quoteInComposer,
    onNavigateToEntry,
    onEditEntry,
    onOpenHistory,
  });
}
</script>

<ConversationPane
  model={{
    conversationId: scrollConversationId,
    open: conversationOpen,
    active,
    timeline,
    streamingText,
    sending: rendered.sending,
    runActivity: {
      activeRun: rendered.activeRun,
      lastRunOutcome,
      stopping,
      pending: pendingWork,
      responseRevision,
      retryingResponse,
    },
    queuedPrompts: rendered.queuedPrompts,
    approvals: rendered.approvals,
    pendingUserQuestions: rendered.pendingUserQuestions,
    pendingPlanReviews: rendered.pendingPlanReviews,
    outcomeUnknownToolCallIds: outcomeUnknownIds,
    activeProject,
    activeProjectLabel,
    planReviewModels,
    planReviewModelKey,
    planReviewThinkingLevel,
    banner: recoveryIssues.length
      ? {
          tone: "warning",
          title: "Recovery needs review",
          message: `${recoveryIssues.length} external operation outcome${recoveryIssues.length === 1 ? " is" : "s are"} unknown. Nerve did not repeat the operation. Inspect the transcript${recoveryIssues.some((issue) => issue.actions.includes("authorize_retry")) ? ", then cancel or explicitly authorize another attempt" : " before taking any further action"}.`,
        }
      : undefined,
    emptyTitle: "Open a conversation or start a new one.",
    composer: {
      text: composerText,
      disabled: !active,
      sending,
      stopping,
      compacting,
      models,
      selectedModelKey,
      thinkingLevel,
      agentProfile,
      agentProfiles,
      lockedFields,
      settingsDiffers,
      profileDisabled,
      permissionRuleSetId,
      permissionRuleSets,
      permissionRuleSetsLoading,
      permissionRuleSetsError,
      contextUsage,
      conversationUsage,
      agentUsage,
      agentUsageLoading,
      agentUsageError,
      contextWindow,
      capabilities: {
        voice: true,
        imagePaste: true,
        fileDrop: true,
        completions: true,
        suggestions: true,
        shortcuts: true,
        todos: true,
        queueing: true,
      },
    },
  }}
  actions={{
    onOpenFile,
    onOpenTask,
    onOpenMermaid: openAssistantMermaid,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    onCancelCompaction,
    onRetryResponse,
    onForcePushQueuedPrompts,
    onDiscardQueuedPrompt,
    onMoveQueuedPromptToComposer,
    onOpenPendingWork,
  }}
  menus={{ transcriptMenu: menuForTranscript, selectionActions }}
  {activity}
>
  {#snippet composer(activityContent)}
    <WorkbenchComposerAdapter
      {composerView}
      activity={activityContent}
      text={composerText}
      {editorOverlay}
      {session}
      {contextActions}
      {activeProject}
      {activeConversation}
      {activePendingConversation}
      {pendingConversationActive}
      {approvals}
      {pendingUserQuestions}
      {pendingPlanReviews}
      interactive={active}
      {sending}
      {stopping}
      {teamRunning}
      {compacting}
      {models}
      {selectedModelKey}
      {contextUsage}
      {conversationUsage}
      {agentUsage}
      {agentUsageLoading}
      {agentUsageError}
      {contextWindow}
      todos={composerTodos}
      focusToken={composerFocusToken}
      {composerEscapeToken}
      {micShortcutToken}
      {thinkingLevel}
      {agentProfile}
      {agentProfiles}
      {lockedFields}
      {settingsDiffers}
      {profileDisabled}
      {permissionRuleSetId}
      {permissionRuleSets}
      {permissionRuleSetsLoading}
      {permissionRuleSetsError}
      {slashCompletions}
      {completionSource}
      {composerSuggestions}
      {onSendSuggestion}
      {onDraftSuggestion}
      onChange={onComposerChange}
      {onSubmit}
      {onAbort}
      onCompact={activeConversation ? onCompact : undefined}
      {onUsageOpenChange}
      {onUsageRetry}
      {onOpenSystemPrompt}
      {onModelSelectionChange}
      {onResetPermission}
      {onAgentProfileChange}
      {onPermissionRuleSetChange}
      {onRefreshPermissionRuleSets}
      {onOpenPermissionSettings}
      {onOpenCapabilitySettings}
    />
  {/snippet}

  {#snippet emptyExtension()}
    {#if !conversationLoading}<ConversationWelcome
        projectSelected={Boolean(activeProject && onNewConversationInProject)}
        projectLabel={activeProjectLabel}
        projectPath={activeProject?.dir}
        onNewChat={(initialProfile) => {
          if (activeProject) {
            onNewConversationInProject?.(activeProject.dir, initialProfile);
          }
        }}
      />{/if}
  {/snippet}
</ConversationPane>
