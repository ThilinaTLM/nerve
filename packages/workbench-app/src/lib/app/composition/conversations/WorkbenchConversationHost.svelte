<script lang="ts">
import { untrack } from "svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { notify } from "$lib/application/notifications/notify.svelte";
import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import type { WorkbenchConversationAdapterProps } from "$lib/features/conversations/views/workbench-conversation-adapter-props";
import { shortProjectLabel } from "$lib/domain/projects/project-tree";
import {
  activeRunStreamingText,
  buildActiveRunTimeline,
  CommittedTimelineProjection,
  currentTodosForAgent,
  hasActiveTurnTimelineOutput,
  selectVisibleCommitted,
} from "$lib/presentation/state";
import { ConversationPane } from "$lib/presentation/conversations";
import { setConversationUiCapabilities } from "$lib/presentation/context.svelte";
import WorkbenchComposerAdapter from "./WorkbenchComposerAdapter.svelte";
import { workbenchConversationUiCapabilities } from "./conversation-capabilities.svelte";
import ConversationWelcome from "$lib/features/conversations/views/ConversationWelcome.svelte";
import { openInlineMermaidPane } from "$lib/features/filesystem";
import type { MermaidMarkdownBlock } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";

setConversationUiCapabilities(workbenchConversationUiCapabilities());
import { transcriptMenu } from "$lib/features/conversations/views/conversation-menus";
import type { TranscriptMenuTarget } from "$lib/presentation/conversations";
import { createConversationRenderProjection } from "$lib/features/conversations/state/conversation-render-projection.svelte";

let {
  activeProject,
  activeConversation,
  activeAgent,
  activePendingConversation,
  homeDir,
  pendingConversationActive = false,
  approvals = [],
  pendingUserQuestions = [],
  pendingPlanReviews = [],
  active = true,
  entries = [],
  optimisticMessages = [],
  toolCalls = [],
  treeNodes = [],
  activeRun,
  transient,
  queuedPrompts = [],
  sending = false,
  stopping: stoppingRequested = false,
  composerText = "",
  models = [],
  selectedModelKey = "",
  planReviewModels = [],
  planReviewModelKey = "",
  planReviewThinkingLevel = "off",
  contextUsage,
  conversationUsage,
  contextWindow = 0,
  composerFocusToken = 0,
  composerEscapeToken = 0,
  micShortcutToken = 0,
  thinkingLevel = "off",
  mode = "coding",
  permissionRuleSetId = "autonomous",
  permissionRuleSets = [],
  permissionRuleSetsLoading = false,
  permissionRuleSetsError,
  slashCompletions = [],
  fileCompletions,
  composerSuggestions = [],
  onSendSuggestion,
  onDraftSuggestion,
  onComposerChange,
  onSubmit,
  onAnswerUserQuestion,
  onDismissUserQuestion,
  onAbort,
  onCompact,
  onNewConversationInProject,
  onOpenFile,
  onModelChange,
  onThinkingLevelChange,
  onModeChange,
  onPermissionRuleSetChange,
  onRefreshPermissionRuleSets,
  onOpenPermissionSettings,
  onGrantApproval,
  onDenyApproval,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
  onContinueFromFailure,
  onForcePushQueuedPrompts,
  onDiscardQueuedPrompt,
  onMoveQueuedPromptToComposer,
  onNavigateToEntry,
  onEditEntry,
  onOpenHistory,
}: WorkbenchConversationAdapterProps = $props();

const composerTodos = $derived(
  currentTodosForAgent(toolCalls, activeAgent?.id),
);
const conversationOpen = $derived(
  Boolean(activeConversation || pendingConversationActive),
);
const activeProjectLabel = $derived(
  activeProject ? shortProjectLabel(activeProject.dir, homeDir) : undefined,
);
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
const combinedTimeline = $derived([...visibleCommitted, ...liveItems]);
const compacting = $derived(transient?.compaction?.state === "running");
const stopping = $derived(
  stoppingRequested || activeRun?.status === "aborting",
);
const streamingText = $derived(activeRunStreamingText(rendered.activeRun));
const treeEntriesById = $derived(
  new Map(treeNodes.map((node) => [node.entry.id, node.entry])),
);
// Latest-turn output remains true when a live row materializes into its durable
// entry, while a newly started empty turn re-enables the waiting indicator.
const hasActiveTurnOutput = $derived(
  hasActiveTurnTimelineOutput(combinedTimeline, rendered.activeRun),
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
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const prefix = composerText ? `${composerText}\n\n` : "";
  onComposerChange?.(`${prefix}${quoted}\n\n`);
}

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
  selectedText?: string,
) {
  return transcriptMenu(target, selectedText, {
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
    hasActiveTurnOutput,
    queuedPrompts: rendered.queuedPrompts,
    approvals: rendered.approvals,
    pendingUserQuestions: rendered.pendingUserQuestions,
    pendingPlanReviews: rendered.pendingPlanReviews,
    activeProject,
    activeProjectLabel,
    planReviewModels,
    planReviewModelKey,
    planReviewThinkingLevel,
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
      mode,
      permissionRuleSetId,
      permissionRuleSets,
      permissionRuleSetsLoading,
      permissionRuleSetsError,
      contextUsage,
      conversationUsage,
      contextWindow,
      capabilities: {
        voice: true,
        imagePaste: true,
        fileDrop: Boolean(getDesktopBridge()?.files),
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
    onOpenMermaid: openAssistantMermaid,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    onForcePushQueuedPrompts,
    onDiscardQueuedPrompt,
    onMoveQueuedPromptToComposer,
  }}
  menus={{ transcriptMenu: menuForTranscript }}
>
  {#snippet composer()}
    <WorkbenchComposerAdapter
      text={composerText}
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
      {compacting}
      {models}
      {selectedModelKey}
      {contextUsage}
      {conversationUsage}
      {contextWindow}
      todos={composerTodos}
      focusToken={composerFocusToken}
      {composerEscapeToken}
      {micShortcutToken}
      {thinkingLevel}
      {mode}
      {permissionRuleSetId}
      {permissionRuleSets}
      {permissionRuleSetsLoading}
      {permissionRuleSetsError}
      {slashCompletions}
      {fileCompletions}
      {composerSuggestions}
      {onSendSuggestion}
      {onDraftSuggestion}
      onChange={onComposerChange}
      {onSubmit}
      {onAbort}
      onCompact={activeConversation ? onCompact : undefined}
      {onModelChange}
      {onThinkingLevelChange}
      {onModeChange}
      {onPermissionRuleSetChange}
      {onRefreshPermissionRuleSets}
      {onOpenPermissionSettings}
    />
  {/snippet}

  {#snippet emptyExtension()}
    <ConversationWelcome
      projectSelected={Boolean(activeProject && onNewConversationInProject)}
      projectLabel={activeProjectLabel}
      projectPath={activeProject?.dir}
      onNewChat={(initialMode) => {
        if (activeProject) {
          onNewConversationInProject?.(activeProject.dir, initialMode);
        }
      }}
    />
  {/snippet}
</ConversationPane>
