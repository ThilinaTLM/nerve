<script lang="ts">
  import Folder from "@lucide/svelte/icons/folder";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import type {
    CompletionItem,
    ContextUsage,
    ConversationRecord,
    ModelInfo,
  } from "$lib/api";
  import type {
    AgentRecord,
    PlanReviewRecord,
    ProjectRecord,
    QueuedPromptRecord,
    ToolCallRecord,
    UserQuestionRecord,
  } from "$lib/api";
  import ContextMenu, {
    type ContextMenuItem,
  } from "$lib/components/ui/context-menu-list";
  import ToolCallCard from "$lib/features/tools/components/ToolCallCard.svelte";
  import ToolDraftCard from "$lib/features/tools/components/tool-call/ToolDraftCard.svelte";
  import ToolResultErrorCard from "$lib/features/tools/components/tool-call/ToolResultErrorCard.svelte";
  import Markdown from "$lib/core/components/Markdown.svelte";
  import { notifyCopyResult } from "$lib/features/notifications/notify.svelte";
  import type { TimelineItem } from "$lib/features/conversations/state/timeline";
  import CompactionCard from "./CompactionCard.svelte";
  import TaskEventCard from "./TaskEventCard.svelte";
  import RunStatusCard from "./RunStatusCard.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";

  type Props = {
    contentEl?: HTMLDivElement;
    bottomEl?: HTMLDivElement;
    timeline: TimelineItem[];
    streamingText: string;
    sending: boolean;
    hasLiveTimelineNodes: boolean;
    queuedPrompts: QueuedPromptRecord[];
    activeProject?: ProjectRecord;
    activeProjectLabel?: string;
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    lastTimelineKey?: string;
    onOpenFile?: (path: string, line?: number) => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
    onAcceptPlanReview?: (id: string) => void;
    onAcceptPlanReviewInNewChat?: (id: string) => void;
    onRejectPlanReview?: (id: string) => void;
    onContinueFromFailure?: (statusEntryId: string) => void;
    messageMenu: (item: import("$lib/features/conversations").TranscriptItem) => ContextMenuItem[];
    toolMenu: (
      anchorEntryId: string | undefined,
      toolCall: ToolCallRecord,
    ) => ContextMenuItem[];
  };

  let {
    contentEl = $bindable(),
    bottomEl = $bindable(),
    timeline,
    streamingText,
    sending,
    hasLiveTimelineNodes,
    queuedPrompts,
    activeProject,
    activeProjectLabel,
    pendingUserQuestion,
    pendingPlanReview,
    lastTimelineKey,
    onOpenFile,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    messageMenu,
    toolMenu,
  }: Props = $props();
</script>

<div bind:this={contentEl} class="transcript-content">
  {#if timeline.length === 0 && !streamingText && !sending}
    <div class="empty-run">
      <div class="prompt-line">
        <span class="prompt-sigil">nerve</span>
        <span class="prompt-arrow">&#10095;</span>
        <span class="prompt-caret" aria-hidden="true"></span>
      </div>
      <span class="prompt-hint">Type below to wake the agent.</span>
      {#if activeProjectLabel}
        <div
          class="prompt-project"
          title={activeProject?.dir}
          aria-label={`Conversation will be created in project ${activeProject?.dir}`}
        >
          <Folder size={13} strokeWidth={2.2} aria-hidden="true" />
          <span class="prompt-project-label">Project:</span>
          <span class="prompt-project-path">{activeProjectLabel}</span>
        </div>
      {/if}
    </div>
  {/if}

  {#each timeline as node (node.key)}
    {#if node.kind === "tool"}
      <ContextMenu
        items={toolMenu(node.anchorEntryId, node.toolCall)}
        triggerClass="block min-w-0"
      >
        <ToolCallCard
          toolCall={node.toolCall}
          liveOutput={node.liveOutput}
          {pendingUserQuestion}
          {pendingPlanReview}
          {onOpenFile}
          {onAnswerUserQuestion}
          {onDismissUserQuestion}
          {onAcceptPlanReview}
          {onAcceptPlanReviewInNewChat}
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
    {:else if node.kind === "compaction"}
      <CompactionCard notice={node.notice} {activeProject} {onOpenFile} />
    {:else if node.kind === "task_event"}
      <TaskEventCard notice={node.notice} />
    {:else}
      <ContextMenu
        items={messageMenu(node.item)}
        triggerClass={`select-text ${node.item.role === "user" ? "user-msg-trigger" : ""}`}
      >
        <article
          class={`transcript-entry ${node.item.role} ${node.item.displayKind === "thinking" ? "thinking-entry" : ""} ${node.item.live ? "streaming" : ""}`}
        >
          <div class="message-body">
            {#if node.item.displayKind === "thinking"}
              <ThinkingBlock
                block={{ text: node.item.text, redacted: node.item.redacted }}
                live={node.item.live && !node.item.done}
              />
            {:else if node.item.text}
              <div class="message-content">
                <Markdown
                  text={node.item.text}
                  trimCodeBlocks={node.item.role !== "assistant"}
                  linkBasePath={activeProject?.dir}
                  {onOpenFile}
                  onCopy={notifyCopyResult}
                />
                {#if node.item.live && !node.item.done}<span
                    class="stream-caret"
                    aria-hidden="true"
                  ></span>{/if}
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

<style>
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
    position: relative;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 0.75rem;
    border-bottom: 0;
  }

  :global(.user-msg-trigger) {
    display: block;
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

  .empty-run {
    display: grid;
    place-content: center;
    gap: 0.35rem;
    min-height: 22rem;
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

</style>
