<script lang="ts">
  import type {
    PlanReviewRecord,
    ProjectRecord,
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
  import type { TranscriptItem } from "$lib/core/types/state-types";
  import type { TimelineItem } from "$lib/features/conversations/state/timeline";
  import CompactionCard from "./CompactionCard.svelte";
  import TaskEventCard from "./TaskEventCard.svelte";
  import RunStatusCard from "./RunStatusCard.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";

  type Props = {
    node: TimelineItem;
    sending: boolean;
    activeProject?: ProjectRecord;
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    hydrateToolBodies?: boolean;
    lastTimelineKey?: string;
    onOpenFile?: (path: string, line?: number) => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
    onAcceptPlanReview?: (id: string) => void;
    onAcceptPlanReviewInNewChat?: (id: string) => void;
    onRejectPlanReview?: (id: string) => void;
    onContinueFromFailure?: (statusEntryId: string) => void;
    messageMenu: (item: TranscriptItem) => ContextMenuItem[];
    toolMenu: (
      anchorEntryId: string | undefined,
      toolCall: ToolCallRecord,
    ) => ContextMenuItem[];
  };

  let {
    node,
    sending,
    activeProject,
    pendingUserQuestion,
    pendingPlanReview,
    hydrateToolBodies = true,
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

{#if node.kind === "tool"}
  <ContextMenu
    items={toolMenu(node.anchorEntryId, node.toolCall)}
    triggerClass="block min-w-0"
  >
    <ToolCallCard
      toolCall={node.toolCall}
      liveOutput={node.liveOutput}
      {pendingUserQuestion}
      hydrateBody={hydrateToolBodies}
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
  <ToolDraftCard draft={node.draft} cwd={activeProject?.dir} />
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
  <CompactionCard notice={node.notice} />
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
              streaming={Boolean(node.item.live && !node.item.done)}
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

<style>
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
</style>
