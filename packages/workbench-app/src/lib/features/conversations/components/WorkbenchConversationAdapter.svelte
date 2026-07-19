<script lang="ts">
import { untrack } from "svelte";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import type { ToolCallTranscriptRecord } from "$lib/api";
import type { TranscriptItem } from "$lib/core/types/state-types";
import type { WorkbenchConversationAdapterProps } from "./workbench-conversation-adapter-props";
import { shortProjectLabel } from "$lib/core/utils/project-tree";
import {
  activeRunStreamingText,
  buildActiveRunTimeline,
  buildCommittedTimeline,
  currentTodosForAgent,
  entriesToTranscript,
  hasActiveTurnTimelineOutput,
  selectVisibleCommitted,
} from "@nervekit/workbench-ui/state";
import { ConversationPane } from "@nervekit/workbench-ui/components/conversation";
import { setConversationUiCapabilities } from "@nervekit/workbench-ui/context";
import WorkbenchComposerAdapter from "../adapters/WorkbenchComposerAdapter.svelte";
import { workbenchConversationUiCapabilities } from "./conversation-capabilities.svelte";
import ConversationWelcome from "./ConversationWelcome.svelte";

setConversationUiCapabilities(workbenchConversationUiCapabilities());
import { messageMenu, toolMenu } from "./conversation-menus";
import { createConversationRenderProjection } from "../state/conversation-render-projection.svelte";

let {
  activeProject,
  activeConversation,
  activeAgent,
  activePendingConversation,
  homeDir,
  pendingConversationActive = false,
  approvals = [],
  pendingUserQuestion,
  pendingPlanReview,
  active = true,
  entries = [],
  optimisticMessages = [],
  toolCalls = [],
  treeNodes = [],
  activeRun,
  transient,
  queuedPrompts = [],
  live = false,
  sending = false,
  stopping: stoppingRequested = false,
  composerText = "",
  models = [],
  selectedModelKey = "",
  planReviewModels = [],
  planReviewModelKey = "",
  planReviewThinkingLevel = "off",
  contextUsage,
  contextWindow = 0,
  composerFocusToken = 0,
  composerEscapeToken = 0,
  micShortcutToken = 0,
  thinkingLevel = "off",
  mode = "coding",
  permissionLevel = "autonomous",
  approvalPolicy = { autoApproveReadOnly: true },
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
  onOpenProject,
  onOpenFile,
  onModelChange,
  onThinkingLevelChange,
  onModeChange,
  onPermissionChange,
  onApprovalPolicyChange,
  onGrantApproval,
  onDenyApproval,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
  onContinueFromFailure,
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
    pendingUserQuestion,
    pendingPlanReview,
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

// Incremental projection: `committed` only recomputes when entries/optimistic
// rows/toolCalls identity changes (i.e. not during pure text streaming), so
// streaming tokens only re-run the small active-run tail.
const transcript = $derived.by(() => [
  ...entriesToTranscript(rendered.entries),
  ...rendered.optimisticMessages,
]);
const committed = $derived.by(() =>
  buildCommittedTimeline(transcript, rendered.toolCalls, {
    includeUnanchoredTerminalToolCalls: !rendered.activeRun,
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
const timeline = $derived([...visibleCommitted, ...liveItems]);
const compacting = $derived(transient?.compaction?.state === "running");
const stopping = $derived(
  stoppingRequested || activeRun?.status === "aborting",
);
const streamingText = $derived(activeRunStreamingText(rendered.activeRun));
const treeEntriesById = $derived(
  new Map(treeNodes.map((node) => [node.entry.id, node.entry])),
);
const parentEntryIdById = $derived(
  new Map(treeNodes.map((node) => [node.entry.id, node.entry.parentEntryId])),
);
// Latest-turn output remains true when a live row materializes into its durable
// entry, while a newly started empty turn re-enables the waiting indicator.
const hasActiveTurnOutput = $derived(
  hasActiveTurnTimelineOutput(timeline, rendered.activeRun),
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

function menuForMessage(item: TranscriptItem) {
  return messageMenu(item, {
    treeEntriesById,
    parentEntryIdById,
    copyText,
    quoteInComposer,
    onNavigateToEntry,
    onEditEntry,
    onOpenHistory,
  });
}

function menuForTool(
  anchorEntryId: string | undefined,
  toolCall: ToolCallTranscriptRecord,
) {
  return toolMenu(anchorEntryId, toolCall, {
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
    pendingUserQuestion: rendered.pendingUserQuestion,
    pendingPlanReview: rendered.pendingPlanReview,
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
      permissionLevel,
      approvalPolicy,
      contextUsage,
      contextWindow,
      capabilities: {
        voice: true,
        imagePaste: true,
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
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    onDiscardQueuedPrompt,
    onMoveQueuedPromptToComposer,
  }}
  menus={{ messageMenu: menuForMessage, toolMenu: menuForTool }}
>
  {#snippet composer()}
    <WorkbenchComposerAdapter
      text={composerText}
      {activeProject}
      {activeConversation}
      {activePendingConversation}
      {pendingConversationActive}
      {approvals}
      {pendingUserQuestion}
      {pendingPlanReview}
      interactive={active}
      {live}
      {sending}
      {stopping}
      {compacting}
      {models}
      {selectedModelKey}
      {contextUsage}
      {contextWindow}
      todos={composerTodos}
      focusToken={composerFocusToken}
      {composerEscapeToken}
      {micShortcutToken}
      {thinkingLevel}
      {mode}
      {permissionLevel}
      {approvalPolicy}
      {slashCompletions}
      {fileCompletions}
      {composerSuggestions}
      {onSendSuggestion}
      {onDraftSuggestion}
      onChange={onComposerChange}
      {onSubmit}
      {onAbort}
      {onModelChange}
      {onThinkingLevelChange}
      {onModeChange}
      {onPermissionChange}
      {onApprovalPolicyChange}
    />
  {/snippet}

  {#snippet emptyExtension()}
    <ConversationWelcome onNewChat={() => onOpenProject?.()} />
  {/snippet}
</ConversationPane>
