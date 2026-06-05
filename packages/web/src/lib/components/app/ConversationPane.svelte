<script lang="ts">
  import Clipboard from "@lucide/svelte/icons/clipboard";
  import Copy from "@lucide/svelte/icons/copy";
  import Hammer from "@lucide/svelte/icons/hammer";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import TextQuote from "@lucide/svelte/icons/text-quote";
  import { tick } from "svelte";
  import { toast } from "svelte-sonner";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ModelInfo, PlanReviewRecord, ProjectRecord, SessionRecord, ToolCallRecord, UserQuestionRecord } from "../../api";
  import Markdown from "../../Markdown.svelte";
  import type { ConversationLiveState, LiveToolCallDraft, TranscriptItem } from "../../stores/workbench/state.svelte";
  import { buildConversationTimeline } from "../../stores/workbench/timeline";
  import { trimTextPreview } from "../../utils/text-preview";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import PromptComposer from "./PromptComposer.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import ToolCallCard from "./ToolCallCard.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    projects?: ProjectRecord[];
    sessions?: SessionRecord[];
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
    onRequestPlanChanges?: (id: string, feedback: string) => void;
    onDiscardPlanReview?: (id: string) => void;
  };

  let {
    activeProject,
    activeSession,
    activeAgent,
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
    onRequestPlanChanges,
    onDiscardPlanReview,
  }: Props = $props();

  let transcriptEl = $state<HTMLDivElement>();
  let bottomEl = $state<HTMLDivElement>();
  let followBottom = $state(true);
  let scrollFrame: number | undefined;

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
    if (activeSession && (sending || hasLiveTimelineNodes)) {
      scheduleBottomScroll({ force: true, smooth: false });
    }
  });

  $effect(() => {
    const _sessionId = activeSession?.id;
    if (_sessionId) scheduleBottomScroll({ force: true, smooth: false });
  });

  $effect(() => {
    return () => cancelScheduledBottomScroll();
  });

  function hidesDraftArgs(toolName?: string): boolean {
    return toolName === "write" || toolName === "edit";
  }

  function argsPreview(draft: LiveToolCallDraft): string {
    if (hidesDraftArgs(draft.toolName)) {
      const toolName = draft.toolName ?? "tool";
      return draft.done
        ? `${toolName} arguments prepared.`
        : `Preparing ${toolName} arguments…`;
    }
    const text = draft.args
      ? JSON.stringify(draft.args, null, 2)
      : draft.argsText.trim() || "Waiting for arguments…";
    return trimTextPreview(text, {
      headLines: 18,
      tailLines: 6,
      maxChars: 6_000,
    }).text;
  }

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
  {#if activeSession}
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
            {onRequestPlanChanges}
            {onDiscardPlanReview}
          />
        {:else if node.kind === "tool_draft"}
          <article class="tool-draft-card">
            <div class="tool-draft-head">
              <Hammer size={13} strokeWidth={2.2} />
              <span>Preparing tool call</span>
              {#if node.draft.toolName}<code>{node.draft.toolName}</code>{/if}
              {#if node.draft.done}<span class="submitted">submitted</span>{/if}
            </div>
            <pre>{argsPreview(node.draft)}</pre>
          </article>
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
      {activeSession}
      {approvals}
      {pendingUserQuestion}
      {pendingPlanReview}
      {live}
      {sending}
      {error}
      {models}
      {selectedModelKey}
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
      <Sparkles size={30} strokeWidth={1.7} />
      <p>No conversation open.</p>
      <span>Open a conversation from the left pane or start a new one.</span>
      <Button variant="secondary" size="sm" onclick={onOpenProject}>New conversation</Button>
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

  .transcript-entry,
  .tool-draft-card {
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
    font-size: 0.8125rem;
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

  .tool-draft-card {
    background: color-mix(in oklab, var(--primary) 4%, transparent);
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

  .tool-draft-card {
    display: grid;
    gap: 0.45rem;
    background: color-mix(in oklab, var(--background) 94%, var(--sidebar));
  }

  .tool-draft-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 650;
  }

  .tool-draft-head code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--sidebar);
    color: var(--foreground);
    padding: 0.1rem 0.42rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
  }

  .submitted {
    color: var(--success, var(--primary));
    font-size: 0.68rem;
  }

  .tool-draft-card pre {
    margin: 0;
    overflow: visible;
    border: 1px solid color-mix(in oklab, var(--border) 58%, transparent);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--sidebar-foreground);
    padding: 0.5rem 0.58rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
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
    min-height: 100%;
    color: var(--muted-foreground);
    text-align: center;
  }

  .empty-run,
  .empty-center {
    gap: 0.35rem;
    min-height: 22rem;
  }

  .empty-run :global(svg),
  .empty-center :global(svg) {
    color: var(--primary);
    justify-self: center;
  }

  .prompt-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: 1.1rem;
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
    font-size: 0.8rem;
    color: var(--muted-foreground);
  }

  @media (prefers-reduced-motion: reduce) {
    .prompt-caret {
      animation: none;
    }
  }

  .empty-run p,
  .empty-center p {
    margin: 0.25rem 0 0;
    color: var(--foreground);
  }

  .empty-center :global(.ui-button) {
    justify-self: center;
    margin-top: 0.45rem;
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
