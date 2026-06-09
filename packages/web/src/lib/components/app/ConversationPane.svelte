<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import Clipboard from "@lucide/svelte/icons/clipboard";
  import Copy from "@lucide/svelte/icons/copy";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import TextQuote from "@lucide/svelte/icons/text-quote";
  import { tick } from "svelte";
  import { notify } from "$lib/notifications/notify.svelte";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ContextUsage, ModelInfo, PlanReviewRecord, ProjectRecord, QueuedPromptRecord, ConversationRecord, ToolCallRecord, UserQuestionRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
  import type { GitSuggestion } from "../../stores/workbench/git-context.svelte";
  import type { ConversationLiveState, TranscriptItem } from "../../stores/workbench/state.svelte";
  import { buildConversationTimeline } from "../../stores/workbench/timeline";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import PromptComposer from "./PromptComposer.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";
  import ToolDraftCard from "./tool-call/ToolDraftCard.svelte";
  import RunStatusCard from "./RunStatusCard.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activeAgent?: AgentRecord;
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
    onRejectPlanReview?: (id: string) => void;
    onContinueFromFailure?: (statusEntryId: string) => void;
  };

  let {
    activeProject,
    activeConversation,
    activeAgent,
    pendingConversationActive = false,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    transcript = [],
    toolCalls = [],
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
    onRejectPlanReview,
    onContinueFromFailure,
  }: Props = $props();

  let transcriptEl = $state<HTMLDivElement>();
  let transcriptContentEl = $state<HTMLDivElement>();
  let composerWrapEl = $state<HTMLDivElement>();
  let bottomEl = $state<HTMLDivElement>();
  let followBottom = $state(true);
  let composerHeight = $state(0);
  let scrollFrame: number | undefined;
  let userScrollIntent = false;
  let userScrollIntentTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerScrollActive = false;

  const BOTTOM_THRESHOLD_PX = 24;
  const USER_SCROLL_AWAY_THRESHOLD_PX = 100;
  const USER_SCROLL_INTENT_TIMEOUT_MS = 350;

  const conversationOpen = $derived(Boolean(activeConversation || pendingConversationActive));
  const timeline = $derived(buildConversationTimeline(transcript, toolCalls, liveState));
  const lastTimelineKey = $derived(timeline.at(-1)?.key);
  const hasLiveTimelineNodes = $derived(
    timeline.some((node) =>
      node.kind === "message"
        ? Boolean(node.item.live)
        : node.kind === "tool_draft"
          ? true
          : node.kind === "tool"
            ? node.toolCall.status === "running"
            : node.notice.state === "retrying",
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
        return `${node.key}:${node.toolCall.status}:${node.liveOutput?.text.length ?? 0}`;
      })
      .join("|"),
  );

  function distanceFromBottom(el: HTMLElement): number {
    return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
  }

  function clearUserScrollIntentTimer() {
    if (userScrollIntentTimer === undefined) return;
    clearTimeout(userScrollIntentTimer);
    userScrollIntentTimer = undefined;
  }

  function markUserScrollIntent() {
    userScrollIntent = true;
    clearUserScrollIntentTimer();
    userScrollIntentTimer = setTimeout(() => {
      userScrollIntent = false;
      userScrollIntentTimer = undefined;
    }, USER_SCROLL_INTENT_TIMEOUT_MS);
  }

  function handleTranscriptScroll() {
    if (!transcriptEl) return;

    const distance = distanceFromBottom(transcriptEl);
    if (distance <= BOTTOM_THRESHOLD_PX) {
      followBottom = true;
      return;
    }

    if (userScrollIntent && distance >= USER_SCROLL_AWAY_THRESHOLD_PX) {
      followBottom = false;
    }
  }

  function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function cancelScheduledBottomScroll() {
    if (scrollFrame === undefined) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
  }

  async function scrollBottomNow(options: { force?: boolean; smooth?: boolean } = {}) {
    if (!transcriptEl) return;
    if (!options.force && !followBottom) return;
    if (options.force) followBottom = true;

    await tick();

    const behavior: ScrollBehavior = options.smooth && !prefersReducedMotion() ? "smooth" : "auto";

    if (bottomEl) {
      bottomEl.scrollIntoView({ block: "end", behavior });
    }

    transcriptEl.scrollTo({ top: transcriptEl.scrollHeight, behavior });
  }

  function scheduleBottomScroll(options: { force?: boolean; smooth?: boolean } = {}) {
    cancelScheduledBottomScroll();
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      void scrollBottomNow(options);
    });
  }

  $effect(() => {
    const _signature = scrollSignature;
    const _queuedPromptSignature = queuedPrompts.map((prompt) => `${prompt.id}:${prompt.text.length}`).join("|");
    const _sending = sending;
    const _streamingTextLength = streamingText.length;
    if (conversationOpen && followBottom) {
      scheduleBottomScroll({ smooth: false });
    }
  });

  $effect(() => {
    const _conversationId = activeConversation?.id ?? (pendingConversationActive ? "pending" : undefined);
    if (_conversationId) scheduleBottomScroll({ force: true, smooth: false });
  });

  $effect(() => {
    const el = transcriptContentEl;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      scheduleBottomScroll({ smooth: false });
    });
    observer.observe(el);

    return () => observer.disconnect();
  });

  $effect(() => {
    const el = composerWrapEl;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updateComposerHeight = () => {
      composerHeight = el.offsetHeight;
    };
    updateComposerHeight();

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(el);

    return () => observer.disconnect();
  });

  $effect(() => {
    const el = transcriptEl;
    if (!el) return;

    const handlePointerDown = () => {
      pointerScrollActive = true;
      markUserScrollIntent();
    };
    const handlePointerMove = () => {
      if (pointerScrollActive) markUserScrollIntent();
    };
    const handlePointerEnd = () => {
      pointerScrollActive = false;
    };

    el.addEventListener("wheel", markUserScrollIntent, { passive: true });
    el.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    el.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    el.addEventListener("pointerdown", handlePointerDown, { passive: true });
    el.addEventListener("pointermove", handlePointerMove, { passive: true });
    el.addEventListener("pointerup", handlePointerEnd, { passive: true });
    el.addEventListener("pointerleave", handlePointerEnd, { passive: true });

    return () => {
      el.removeEventListener("wheel", markUserScrollIntent);
      el.removeEventListener("touchstart", markUserScrollIntent);
      el.removeEventListener("touchmove", markUserScrollIntent);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerEnd);
      el.removeEventListener("pointerleave", handlePointerEnd);
    };
  });

  $effect(() => {
    return () => {
      cancelScheduledBottomScroll();
      clearUserScrollIntentTimer();
    };
  });

  async function copyText(text: string, label = "message") {
    try {
      await navigator.clipboard?.writeText(text);
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

  function messageMenu(item: TranscriptItem): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: "Copy text", icon: Clipboard, onSelect: () => void copyText(item.text) },
      { label: "Quote in composer", icon: TextQuote, onSelect: () => quoteInComposer(item.text) },
    ];
    if (item.id) {
      items.push({ type: "separator" });
      items.push({ label: "Copy message id", icon: Copy, onSelect: () => void copyText(item.id ?? "", "message id") });
    }
    return items;
  }
</script>

<section class="conversation-pane">
  {#if conversationOpen}
    <div
      bind:this={transcriptEl}
      class="transcript"
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
      onscroll={handleTranscriptScroll}
    >
      <div bind:this={transcriptContentEl} class="transcript-content">
      {#if timeline.length === 0 && !streamingText && !sending}
        <div class="empty-run">
          <div class="prompt-line">
            <span class="prompt-sigil">nerve</span>
            <span class="prompt-arrow">&#10095;</span>
            <span class="prompt-caret" aria-hidden="true"></span>
          </div>
          <span class="prompt-hint">Type below to wake the agent.</span>
        </div>
      {/if}

      {#each timeline as node (node.key)}
        {#if node.kind === "tool"}
          <ToolCallCard
            toolCall={node.toolCall}
            liveOutput={node.liveOutput}
            {pendingUserQuestion}
            {pendingPlanReview}
            {onOpenFile}
            {onAnswerUserQuestion}
            {onDismissUserQuestion}
            {onAcceptPlanReview}
            {onRejectPlanReview}
          />
        {:else if node.kind === "tool_draft"}
          <ToolDraftCard draft={node.draft} />
        {:else if node.kind === "run_status"}
          <RunStatusCard
            notice={node.notice}
            isLast={node.key === lastTimelineKey}
            {sending}
            {onContinueFromFailure}
          />
        {:else}
          <ContextMenu items={messageMenu(node.item)} triggerClass={`select-text ${node.item.role === "user" ? "user-msg-trigger" : ""}`}>
            <article class={`transcript-entry ${node.item.role} ${node.item.displayKind === "thinking" ? "thinking-entry" : ""} ${node.item.live ? "streaming" : ""}`}>
              <div class="message-body">
                {#if node.item.displayKind === "thinking"}
                  <ThinkingBlock block={{ text: node.item.text, redacted: node.item.redacted }} live={node.item.live && !node.item.done} />
                {:else if node.item.text}
                  <div class="message-content">
                    <Markdown text={node.item.text} trimCodeBlocks={node.item.role !== "assistant"} />
                    {#if node.item.live && !node.item.done}<span class="stream-caret" aria-hidden="true"></span>{/if}
                  </div>
                {/if}
              </div>
              {#if node.item.text}
                <Button class="copy-btn" variant="ghost" size="icon-sm" ariaLabel="Copy message" title="Copy message" onclick={() => void copyText(node.item.text)}>
                  <Clipboard size={12} strokeWidth={2.2} />
                </Button>
              {/if}
            </article>
          </ContextMenu>
        {/if}
      {/each}

      {#if sending && !hasLiveTimelineNodes}
        <article class="transcript-entry assistant streaming waiting-entry">
          <div class="message-body">
            <div class="message-content streaming-content">
              <span class="stream-caret" aria-hidden="true"></span>
            </div>
          </div>
        </article>
      {/if}

      {#if queuedPrompts.length > 0}
        <div class="queued-prompts" aria-label="Queued prompts">
          {#each queuedPrompts as queuedPrompt (queuedPrompt.id)}
            <div class="queued-prompt">
              <ListPlus size={14} strokeWidth={2.2} />
              <span class="queued-label">Queued</span>
              <span class="queued-text">{queuedPrompt.text}</span>
            </div>
          {/each}
        </div>
      {/if}

        <div bind:this={bottomEl} class="transcript-bottom" aria-hidden="true"></div>
      </div>
    </div>

    {#if !followBottom && composerHeight > 0}
      <div class="scroll-bottom-button-wrap" style={`bottom: ${composerHeight + 8}px;`}>
        <Button class="rounded-full" variant="secondary" size="icon-sm" ariaLabel="Scroll to latest" title="Scroll to latest" onclick={() => scheduleBottomScroll({ force: true, smooth: false })}>
          <ArrowDown size={16} strokeWidth={2.4} />
        </Button>
      </div>
    {/if}

    <div bind:this={composerWrapEl} class="composer-wrap">
      <PromptComposer
        text={composerText}
        {activeProject}
        {activeConversation}
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
      <Button class="empty-action" variant="ghost" size="sm" onclick={onOpenProject}>New conversation</Button>
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

  .transcript-content {
    display: grid;
    align-content: start;
    gap: 0.1rem;
    min-height: 100%;
    min-width: 0;
  }

  .transcript-bottom {
    height: 1px;
    overflow-anchor: auto;
  }

  .scroll-bottom-button-wrap {
    position: absolute;
    right: 1.15rem;
    z-index: 4;
    border-radius: 999px;
    box-shadow: 0 0.35rem 1rem color-mix(in oklab, var(--background) 45%, transparent);
  }

  .queued-prompts {
    display: grid;
    gap: 0.45rem;
    margin: 0.5rem 0 0.75rem;
  }

  .queued-prompt {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-self: end;
    max-width: min(42rem, 82%);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    background: var(--muted);
    color: var(--muted-foreground);
    padding: 0.45rem 0.65rem;
    font-size: var(--text-xs);
  }

  .queued-label {
    font-weight: 600;
    color: var(--foreground);
  }

  .queued-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .transcript-entry {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 0.75rem;
    border-bottom: 0;
  }

  :global(.user-msg-trigger) {
    display: block;
  }

  .transcript-entry {
    position: relative;
  }

  .transcript-entry.user {
    width: fit-content;
    max-width: 70%;
    margin-left: auto;
    border: 1px solid color-mix(in oklab, var(--primary) 16%, var(--border));
    border-radius: var(--radius-lg);
    border-bottom-right-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--primary) 12%, var(--card));
    padding: 0.55rem 0.8rem;
  }


  .message-body {
    position: relative;
    min-width: 0;
    overflow: hidden;
  }

  .transcript-entry :global(.copy-btn) {
    position: absolute;
    top: 0.35rem;
    right: 0.35rem;
    opacity: 0;
    transition: opacity 0.12s ease;
    background: color-mix(in oklab, var(--background) 65%, transparent);
    backdrop-filter: blur(3px);
    color: var(--muted-foreground);
  }

  /* User bubbles are small and right-aligned: float the copy action just
     outside the bubble on the left so it never overlaps the text. */
  .transcript-entry.user :global(.copy-btn) {
    top: 50%;
    right: 100%;
    margin-right: 0.4rem;
    transform: translateY(-50%);
    background: transparent;
    backdrop-filter: none;
  }

  .transcript-entry:hover :global(.copy-btn),
  .transcript-entry :global(.copy-btn:focus-visible) {
    opacity: 1;
  }

  .message-content {
    min-width: 0;
    color: color-mix(in oklab, var(--foreground) 92%, transparent);
    font-size: var(--text-sm);
  }

  .streaming-content {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--muted-foreground);
  }

  .transcript-entry.user .message-content {
    color: var(--foreground);
  }

  .stream-caret {
    display: inline-block;
    width: 0.42rem;
    height: 1em;
    margin-left: 0.15rem;
    margin-top: 0.18rem;
    background: var(--primary);
    animation: pulse 1s steps(2, start) infinite;
  }

  .empty-run,
  .empty-center {
    display: grid;
    place-content: center;
    gap: 0.35rem;
    min-height: 22rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .empty-center {
    min-height: 100%;
    padding: 2rem;
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

  @media (prefers-reduced-motion: reduce) {
    .prompt-caret {
      animation: none;
    }
  }

  .empty-center :global(.empty-action) {
    justify-self: center;
    margin-top: 0.6rem;
    color: var(--muted-foreground);
  }

  @keyframes pulse {
    50% { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .stream-caret {
      animation: none;
    }
  }
</style>
