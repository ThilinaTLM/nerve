<script lang="ts">
  import Clipboard from "@lucide/svelte/icons/clipboard";
  import Copy from "@lucide/svelte/icons/copy";
  import TextQuote from "@lucide/svelte/icons/text-quote";
  import { tick } from "svelte";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ContextUsage, ModelInfo, PlanReviewRecord, ProjectRecord, ConversationRecord, ToolCallRecord, UserQuestionRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
  import type { ConversationLiveState, TranscriptItem } from "../../stores/workbench/state.svelte";
  import { buildConversationTimeline } from "../../stores/workbench/timeline";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import PromptComposer from "./PromptComposer.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";
  import ToolDraftCard from "./tool-call/ToolDraftCard.svelte";

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
    live?: boolean;
    sending?: boolean;
    error?: string;
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
    live = false,
    sending = false,
    error,
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
  }: Props = $props();

  let transcriptEl = $state<HTMLDivElement>();
  let bottomEl = $state<HTMLDivElement>();
  let followBottom = $state(true);
  let scrollFrame: number | undefined;

  const conversationOpen = $derived(Boolean(activeConversation || pendingConversationActive));
  const timeline = $derived(buildConversationTimeline(transcript, toolCalls, liveState));
  const hasLiveTimelineNodes = $derived(
    timeline.some((node) =>
      node.kind === "message"
        ? Boolean(node.item.live)
        : node.kind === "tool_draft" || node.toolCall.status === "running",
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
        return `${node.key}:${node.toolCall.status}:${node.liveOutput?.text.length ?? 0}`;
      })
      .join("|"),
  );

  function nearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  function handleTranscriptScroll() {
    if (!transcriptEl) return;
    followBottom = nearBottom(transcriptEl);
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
    if (conversationOpen && (sending || hasLiveTimelineNodes)) {
      scheduleBottomScroll({ force: true, smooth: false });
    }
  });

  $effect(() => {
    const _conversationId = activeConversation?.id ?? (pendingConversationActive ? "pending" : undefined);
    if (_conversationId) scheduleBottomScroll({ force: true, smooth: false });
  });

  $effect(() => {
    return () => cancelScheduledBottomScroll();
  });

  async function copyText(text: string, label = "message") {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error("Could not copy to clipboard");
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
    <div bind:this={transcriptEl} class="transcript" aria-live="polite" onscroll={handleTranscriptScroll}>
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
        {:else}
          <ContextMenu items={messageMenu(node.item)} triggerClass={`select-text ${node.item.role === "user" ? "user-msg-trigger" : ""}`}>
            <article class={`transcript-entry ${node.item.role} ${node.item.displayKind === "thinking" ? "thinking-entry" : ""} ${node.item.live ? "streaming" : ""}`}>
              <div class="message-body">
                {#if node.item.displayKind === "thinking"}
                  <ThinkingBlock block={{ text: node.item.text, redacted: node.item.redacted }} live={node.item.live && !node.item.done} />
                {:else if node.item.text}
                  <div class="message-content">
                    <Markdown text={node.item.text} />
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

      <div bind:this={bottomEl} class="transcript-bottom" aria-hidden="true"></div>
    </div>

    {#if sending && !followBottom}
      <Button class="jump-latest" variant="secondary" size="sm" onclick={() => scheduleBottomScroll({ force: true, smooth: true })}>Jump to latest</Button>
    {/if}

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
      {error}
      {models}
      {selectedModelKey}
      {contextUsage}
      {contextWindow}
      {thinkingLevel}
      {mode}
      {permissionLevel}
      {slashCompletions}
      {fileCompletions}
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
    display: grid;
    align-content: start;
    gap: 0.1rem;
    min-height: 0;
    overflow: auto;
    overflow-anchor: none;
    padding: 0.75rem 0.75rem 1.1rem;
  }

  .transcript-bottom {
    height: 1px;
    overflow-anchor: auto;
  }

  .transcript-entry {
    width: 100%;
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

  .jump-latest {
    position: absolute;
    right: 1.1rem;
    bottom: 5.6rem;
    z-index: 4;
    box-shadow: 0 0.4rem 1.2rem color-mix(in oklab, var(--background) 45%, transparent);
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
