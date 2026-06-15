<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import { writeClipboardText } from "$lib/clipboard";
  import { notify } from "$lib/notifications/notify.svelte";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ContextUsage, ConversationEntry, ConversationRecord, ConversationTreeNode, ModelInfo, PlanReviewRecord, ProjectRecord, QueuedPromptRecord, ToolCallRecord, UserQuestionRecord } from "$lib/api";
  import type { GitSuggestion } from "$lib/stores/workbench/git-context.svelte";
  import type { ConversationLiveState, PendingConversationState, TranscriptItem } from "$lib/stores/workbench/state.svelte";
  import { shortProjectLabel } from "$lib/utils/project-tree";
  import { buildConversationTimeline } from "$lib/stores/workbench/timeline";
  import { Button } from "$lib/components/ui/button";
  import PromptComposer from "./PromptComposer.svelte";
  import TranscriptList from "./TranscriptList.svelte";
  import { messageMenu, toolMenu } from "./conversation-menus";
  import { createConversationScrollController } from "./conversation-scroll.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activeAgent?: AgentRecord;
    activePendingConversation?: PendingConversationState;
    pendingConversationActive?: boolean;
    projects?: ProjectRecord[];
    conversations?: ConversationRecord[];
    agents?: AgentRecord[];
    homeDir?: string;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    transcript?: TranscriptItem[];
    toolCalls?: ToolCallRecord[];
    treeNodes?: ConversationTreeNode[];
    streamingText?: string;
    liveState?: ConversationLiveState;
    queuedPrompts?: QueuedPromptRecord[];
    live?: boolean;
    sending?: boolean;
    composerText?: string;
    models?: ModelInfo[];
    selectedModelKey?: string;
    contextUsage?: ContextUsage;
    contextWindow?: number;
    composerFocusToken?: number;
    composerEscapeToken?: number;
    micShortcutToken?: number;
    thinkingLevel?: AgentRecord["thinkingLevel"];
    mode?: AgentRecord["mode"];
    permissionLevel?: AgentRecord["permissionLevel"];
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    gitSuggestions?: GitSuggestion[];
    onSendGitSuggestion?: (suggestion: GitSuggestion) => void;
    onDraftGitSuggestion?: (suggestion: GitSuggestion) => void;
    onComposerChange?: (value: string) => void;
    onSubmit?: () => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
    onAbort?: () => void;
    onOpenProject?: () => void;
    onNewConversationInProject?: (projectDir: string) => void;
    onOpenFile?: (path: string, line?: number) => void;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: AgentRecord["thinkingLevel"]) => void;
    onModeChange?: (value: AgentRecord["mode"]) => void;
    onPermissionChange?: (value: AgentRecord["permissionLevel"]) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
    onAcceptPlanReview?: (id: string) => void;
    onAcceptPlanReviewInNewChat?: (id: string) => void;
    onRejectPlanReview?: (id: string) => void;
    onContinueFromFailure?: (statusEntryId: string) => void;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onEditEntry?: (entry: ConversationEntry) => void;
    onOpenHistory?: () => void;
  };

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
    transcript = [],
    toolCalls = [],
    treeNodes = [],
    streamingText = "",
    liveState,
    queuedPrompts = [],
    live = false,
    sending = false,
    composerText = "",
    models = [],
    selectedModelKey = "",
    contextUsage,
    contextWindow = 0,
    composerFocusToken = 0,
    composerEscapeToken = 0,
    micShortcutToken = 0,
    thinkingLevel = "off",
    mode = "coding",
    permissionLevel = "autonomous",
    slashCompletions = [],
    fileCompletions,
    gitSuggestions = [],
    onSendGitSuggestion,
    onDraftGitSuggestion,
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
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    onNavigateToEntry,
    onEditEntry,
    onOpenHistory,
  }: Props = $props();

  const conversationOpen = $derived(Boolean(activeConversation || pendingConversationActive));
  const activeProjectLabel = $derived(activeProject ? shortProjectLabel(activeProject.dir, homeDir) : undefined);
  const timeline = $derived(buildConversationTimeline(transcript, toolCalls, liveState));
  const treeEntriesById = $derived(
    new Map(treeNodes.map((node) => [node.entry.id, node.entry])),
  );
  const parentEntryIdById = $derived(
    new Map(
      treeNodes.map((node) => [node.entry.id, node.entry.parentEntryId]),
    ),
  );
  const lastTimelineKey = $derived(timeline.at(-1)?.key);
  const hasLiveTimelineNodes = $derived(
    timeline.some((node) =>
      node.kind === "message"
        ? Boolean(node.item.live)
        : node.kind === "tool_draft"
          ? true
          : node.kind === "tool"
            ? node.toolCall.status === "running"
            : node.kind === "run_status"
              ? node.notice.state === "retrying"
              : false,
    ),
  );
  const scrollSignature = $derived(
    timeline
      .map((node) => {
        if (node.kind === "message") {
          return `${node.key}:${node.item.text.length}:${node.item.live ? "live" : "done"}`;
        }
        if (node.kind === "tool_draft") {
          return `${node.key}:${node.draft.argsText.length}:${node.draft.done ? "done" : "live"}`;
        }
        if (node.kind === "run_status") {
          return `${node.key}:${node.notice.state}:${node.notice.attempt ?? 0}:${node.notice.errorMessage?.length ?? 0}`;
        }
        if (node.kind === "tool_result_error") {
          return `${node.key}:${node.toolName}:${node.error.length}`;
        }
        return `${node.key}:${node.toolCall.status}:${node.liveOutput?.text.length ?? 0}`;
      })
      .join("|"),
  );
  const queuedPromptSignature = $derived(
    queuedPrompts.map((prompt) => `${prompt.id}:${prompt.text.length}`).join("|"),
  );
  const scroll = createConversationScrollController({
    conversationOpen: () => conversationOpen,
    conversationId: () =>
      activeConversation?.id ?? (pendingConversationActive ? "pending" : undefined),
    scrollSignature: () => scrollSignature,
    queuedPromptSignature: () => queuedPromptSignature,
    sending: () => sending,
    streamingTextLength: () => streamingText.length,
  });

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
    toolCall: ToolCallRecord,
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

<section class="conversation-pane">
  {#if conversationOpen}
    <div
      bind:this={scroll.transcriptEl}
      class="transcript"
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      onscroll={scroll.handleTranscriptScroll}
    >
      <TranscriptList
        bind:contentEl={scroll.transcriptContentEl}
        bind:bottomEl={scroll.bottomEl}
        {timeline}
        {streamingText}
        {sending}
        {hasLiveTimelineNodes}
        {queuedPrompts}
        {activeProject}
        {activeProjectLabel}
        {pendingUserQuestion}
        {pendingPlanReview}
        {lastTimelineKey}
        {onOpenFile}
        {onAnswerUserQuestion}
        {onDismissUserQuestion}
        {onAcceptPlanReview}
        {onAcceptPlanReviewInNewChat}
        {onRejectPlanReview}
        {onContinueFromFailure}
        messageMenu={menuForMessage}
        toolMenu={menuForTool}
      />
    </div>

    {#if !scroll.followBottom && scroll.composerHeight > 0}
      <div class="scroll-bottom-button-wrap" style={`bottom: ${scroll.composerHeight + 8}px;`}>
        <Button class="rounded-full" variant="secondary" size="icon-sm" ariaLabel="Scroll to latest" title="Scroll to latest" onclick={() => scroll.scheduleBottomScroll({ force: true, smooth: false })}>
          <ArrowDown size={16} strokeWidth={2.4} />
        </Button>
      </div>
    {/if}

    <div bind:this={scroll.composerWrapEl} class="composer-wrap">
      <PromptComposer
        text={composerText}
        {activeProject}
        {activeConversation}
        {activePendingConversation}
        {pendingConversationActive}
        {approvals}
        {pendingUserQuestion}
        {pendingPlanReview}
        {live}
        {sending}
        {models}
        {selectedModelKey}
        {contextUsage}
        {contextWindow}
        focusToken={composerFocusToken}
        {composerEscapeToken}
        {micShortcutToken}
        {thinkingLevel}
        {mode}
        {permissionLevel}
        {slashCompletions}
        {fileCompletions}
        {gitSuggestions}
        {onSendGitSuggestion}
        {onDraftGitSuggestion}
        onChange={onComposerChange}
        {onSubmit}
        {onAbort}
        {onModelChange}
        {onThinkingLevelChange}
        {onModeChange}
        {onPermissionChange}
        {onGrantApproval}
        {onDenyApproval}
      />
    </div>
  {:else}
    <div class="empty-center">
      <div class="prompt-line" aria-label="Nerve prompt">
        <span class="prompt-sigil">nerve</span>
        <span class="prompt-arrow">&#10095;</span>
        <span class="prompt-caret" aria-hidden="true"></span>
      </div>
      <span class="prompt-hint">Open a conversation or start a new one.</span>
      <Button class="empty-action" variant="ghost" size="sm" onclick={onOpenProject}>New chat</Button>
    </div>
  {/if}
</section>

<style>
  .conversation-pane {
    position: relative;
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--background);
  }

  .transcript {
    min-height: 0;
    overflow: auto;
    overflow-anchor: none;
    padding: 0.75rem 0.75rem 1.1rem;
  }

  .composer-wrap {
    min-width: 0;
  }

  .scroll-bottom-button-wrap {
    position: absolute;
    right: 1.15rem;
    z-index: 4;
    border-radius: 999px;
    box-shadow: 0 0.35rem 1rem color-mix(in oklab, var(--background) 45%, transparent);
  }

  .empty-center {
    display: grid;
    place-content: center;
    gap: 0.35rem;
    min-height: 100%;
    padding: 2rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .prompt-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    letter-spacing: 0.02em;
  }

  .prompt-sigil {
    color: var(--muted-foreground);
  }

  .prompt-arrow {
    color: var(--primary);
    font-weight: 600;
  }

  .prompt-caret {
    width: 0.55rem;
    height: 1.2rem;
    background: var(--primary);
    display: inline-block;
    animation: pulse 1.1s steps(1) infinite;
  }

  .prompt-hint {
    margin-top: 0.7rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }

  .empty-center :global(.empty-action) {
    justify-self: center;
    margin-top: 0.6rem;
    color: var(--muted-foreground);
  }

  @keyframes pulse {
    50% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .prompt-caret {
      animation: none;
    }
  }
</style>
