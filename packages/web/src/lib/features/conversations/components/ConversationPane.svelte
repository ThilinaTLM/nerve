<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Clipboard from "@lucide/svelte/icons/clipboard";
  import Copy from "@lucide/svelte/icons/copy";
  import Folder from "@lucide/svelte/icons/folder";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import Pencil from "@lucide/svelte/icons/pencil";
  import TextQuote from "@lucide/svelte/icons/text-quote";
  import { tick } from "svelte";
  import { writeClipboardText } from "$lib/clipboard";
  import { notify } from "$lib/notifications/notify.svelte";
  import type { AgentRecord, ApprovalWithToolCall, CompletionItem, ContextUsage, ConversationEntry, ConversationRecord, ConversationTreeNode, ModelInfo, PlanReviewRecord, ProjectRecord, QueuedPromptRecord, ToolCallRecord, UserQuestionRecord } from "$lib/api";
  import Markdown from "$lib/Markdown.svelte";
  import type { GitSuggestion } from "$lib/stores/workbench/git-context.svelte";
  import type { ConversationLiveState, TranscriptItem } from "$lib/stores/workbench/state.svelte";
  import { shortProjectLabel } from "$lib/utils/project-tree";
  import { buildConversationTimeline } from "$lib/stores/workbench/timeline";
  import { Button } from "$lib/components/ui/button";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import PromptComposer from "./PromptComposer.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import ToolCallCard from "$lib/features/tools/components/ToolCallCard.svelte";
  import ToolDraftCard from "$lib/features/tools/components/tool-call/ToolDraftCard.svelte";
  import ToolResultErrorCard from "$lib/features/tools/components/tool-call/ToolResultErrorCard.svelte";
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
    onRejectPlanReview,
    onContinueFromFailure,
    onNavigateToEntry,
    onEditEntry,
    onOpenHistory,
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

  function baseEntryId(id: string | undefined): string | undefined {
    if (!id) return undefined;
    return id.split(":thinking:")[0];
  }

  function parentEntryIdFor(id: string | undefined): string | undefined {
    const baseId = baseEntryId(id);
    return baseId ? parentEntryIdById.get(baseId) : undefined;
  }

  function entryForTranscriptItem(item: TranscriptItem): ConversationEntry | undefined {
    const id = baseEntryId(item.id);
    return id ? treeEntriesById.get(id) : undefined;
  }

  function navigateFromItem(item: TranscriptItem) {
    const id = baseEntryId(item.id);
    if (id) onNavigateToEntry?.(id);
  }

  function navigateBeforeItem(item: TranscriptItem) {
    onNavigateToEntry?.(parentEntryIdFor(item.id));
  }

  function editItem(item: TranscriptItem) {
    const entry = entryForTranscriptItem(item);
    if (entry) onEditEntry?.(entry);
  }

  function messageMenu(item: TranscriptItem): ContextMenuItem[] {
    const entryId = baseEntryId(item.id);
    const canBranch = Boolean(entryId && treeEntriesById.has(entryId));
    const entry = entryForTranscriptItem(item);
    const items: ContextMenuItem[] = [];

    if (canBranch) {
      items.push(
        { label: "Continue from here", icon: ArrowRight, onSelect: () => navigateFromItem(item) },
        { label: "Fork from before this message", icon: GitBranch, onSelect: () => navigateBeforeItem(item) },
      );
      if (entry?.role === "user") {
        items.push({ label: "Edit & resend", icon: Pencil, onSelect: () => editItem(item) });
      }
      items.push({ type: "separator" });
    }

    items.push(
      { label: "Copy text", icon: Clipboard, onSelect: () => void copyText(item.text) },
      { label: "Quote in composer", icon: TextQuote, onSelect: () => quoteInComposer(item.text) },
    );
    if (item.id) {
      items.push({ type: "separator" });
      items.push({ label: "Copy message id", icon: Copy, onSelect: () => void copyText(item.id ?? "", "message id") });
    }
    if (onOpenHistory) {
      items.push({ type: "separator" });
      items.push({ label: "Show branch history", icon: GitBranch, onSelect: onOpenHistory });
    }
    return items;
  }

  function toolMenu(anchorEntryId: string | undefined, toolCall: ToolCallRecord): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (anchorEntryId) {
      items.push({
        label: "Continue after this tool result",
        icon: ArrowRight,
        onSelect: () => onNavigateToEntry?.(anchorEntryId),
      });
      items.push({ type: "separator" });
    }
    items.push({ label: "Copy tool id", icon: Copy, onSelect: () => void copyText(toolCall.id, "tool id") });
    if (onOpenHistory) {
      items.push({ type: "separator" });
      items.push({ label: "Show branch history", icon: GitBranch, onSelect: onOpenHistory });
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
          {#if activeProjectLabel}
            <div class="prompt-project" title={activeProject?.dir} aria-label={`Conversation will be created in project ${activeProject?.dir}`}>
              <Folder size={13} strokeWidth={2.2} aria-hidden="true" />
              <span class="prompt-project-label">Project:</span>
              <span class="prompt-project-path">{activeProjectLabel}</span>
            </div>
          {/if}
        </div>
      {/if}

      {#each timeline as node (node.key)}
        {#if node.kind === "tool"}
          <ContextMenu items={toolMenu(node.anchorEntryId, node.toolCall)} triggerClass="block min-w-0">
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
          </ContextMenu>
        {:else if node.kind === "tool_draft"}
          <ToolDraftCard draft={node.draft} />
        {:else if node.kind === "tool_result_error"}
          <ToolResultErrorCard toolName={node.toolName} error={node.error} />
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
                    <Markdown text={node.item.text} trimCodeBlocks={node.item.role !== "assistant"} linkBasePath={activeProject?.dir} {onOpenFile} />
                    {#if node.item.live && !node.item.done}<span class="stream-caret" aria-hidden="true"></span>{/if}
                  </div>
                {/if}
              </div>
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

  .prompt-project {
    display: inline-flex;
    align-items: center;
    justify-self: center;
    max-width: min(28rem, 86vw);
    gap: 0.4rem;
    margin-top: 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--muted);
    padding: 0.25rem 0.55rem;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .prompt-project-label {
    flex: 0 0 auto;
    color: var(--muted-foreground);
  }

  .prompt-project-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--foreground);
    font-family: var(--font-mono);
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
