<script lang="ts">
  import type {
    AgentRecord,
    ApprovalWithToolCall,
    ModelInfo,
    PlanReviewRecord,
    PlanReviewResolveOptions,
    ProjectRecord,
    ToolCallTranscriptRecord,
    UserQuestionRecord,
  } from "../../state/tool-types";
  import ContextMenu, {
    type ContextMenuItem,
  } from "@nervekit/ui/components/ui/context-menu-list";
  import ToolCallCard from "../../tools/components/ToolCallCard.svelte";
  import ToolDraftCard from "../../tools/components/tool-call/ToolDraftCard.svelte";
  import ToolResultErrorCard from "../../tools/components/tool-call/ToolResultErrorCard.svelte";
  import Markdown from "@nervekit/ui/core/components/Markdown.svelte";
  import PlainText from "@nervekit/ui/core/components/PlainText.svelte";
  import { notifyCopyResult } from "@nervekit/ui/core/notify";
  import type { TranscriptItem } from "../../state/transcript-types";
  import type { TimelineItem } from "../../state/timeline";
  import CompactionCard from "./CompactionCard.svelte";
  import TaskEventCard from "./TaskEventCard.svelte";
  import RunStatusCard from "./RunStatusCard.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";

  type Props = {
    node: TimelineItem;
    sending: boolean;
    activeProject?: ProjectRecord;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    hydrateToolBodies?: boolean;
    planReviewModels?: ModelInfo[];
    planReviewModelKey?: string;
    planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
    lastTimelineKey?: string;
    onOpenFile?: (path: string, line?: number) => void;
    onAnswerUserQuestion?: (questionId: string, answer: string) => void;
    onDismissUserQuestion?: (questionId: string) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
    onAcceptPlanReview?: (
      id: string,
      options?: PlanReviewResolveOptions,
    ) => void | Promise<void>;
    onAcceptPlanReviewInNewChat?: (
      id: string,
      options?: PlanReviewResolveOptions,
    ) => void | Promise<void>;
    onRejectPlanReview?: (id: string) => void;
    onContinueFromFailure?: (statusEntryId: string) => void;
    messageMenu: (item: TranscriptItem) => ContextMenuItem[];
    toolMenu: (
      anchorEntryId: string | undefined,
      toolCall: ToolCallTranscriptRecord,
    ) => ContextMenuItem[];
  };

  let {
    node,
    sending,
    activeProject,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    hydrateToolBodies = true,
    planReviewModels = [],
    planReviewModelKey = "",
    planReviewThinkingLevel = "off",
    lastTimelineKey,
    onOpenFile,
    onAnswerUserQuestion,
    onDismissUserQuestion,
    onGrantApproval,
    onDenyApproval,
    onAcceptPlanReview,
    onAcceptPlanReviewInNewChat,
    onRejectPlanReview,
    onContinueFromFailure,
    messageMenu,
    toolMenu,
  }: Props = $props();

  // Lifecycle for normal message rows. `running` while a live assistant message
  // streams, `complete` once the same live message is done, `static` for
  // persisted/non-live rows and user/system rows.
  const messageState = $derived.by<"running" | "complete" | "static">(() => {
    if (node.kind !== "message") return "static";
    const item = node.item;
    if (item.role === "assistant" && item.live) {
      return item.done ? "complete" : "running";
    }
    return "static";
  });

  // Transient one-shot settle, only on a real running -> complete change.
  // Initialize the tracker to the current value so an already-complete row
  // mounting (scrollback, reload, recycled VirtualScroller instance) does not
  // fire a spurious settle.
  let settling = $state(false);
  let previousMessageState: "running" | "complete" | "static" | undefined;
  $effect(() => {
    const current = messageState;
    if (previousMessageState === undefined) {
      previousMessageState = current;
      return;
    }
    if (previousMessageState === "running" && current === "complete") {
      settling = true;
    }
    previousMessageState = current;
  });
</script>

{#if node.kind === "tool"}
  <ContextMenu
    items={toolMenu(node.anchorEntryId, node.toolCall)}
    triggerClass="block min-w-0"
  >
    <ToolCallCard
      toolCall={node.toolCall}
      liveOutput={node.liveOutput}
      pendingApproval={approvals.find(
        (approval) =>
          approval.toolCallId === node.toolCall.id &&
          approval.status === "pending",
      )}
      {pendingUserQuestion}
      hydrateBody={hydrateToolBodies}
      {pendingPlanReview}
      {onOpenFile}
      {planReviewModels}
      {planReviewModelKey}
      {planReviewThinkingLevel}
      {onAnswerUserQuestion}
      {onDismissUserQuestion}
      {onGrantApproval}
      {onDenyApproval}
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
      class:state-settling={settling}
      data-state={messageState}
      onanimationend={(event) => {
        if (event.target === event.currentTarget) settling = false;
      }}
    >
      <div class="message-body">
        {#if node.item.displayKind === "thinking"}
          <ThinkingBlock
            block={{ text: node.item.text, redacted: node.item.redacted }}
            live={node.item.live && !node.item.done}
          />
        {:else if node.item.text}
          <div class="message-content">
            {#if node.item.role === "user"}
              <PlainText text={node.item.text} />
            {:else}
              <Markdown
                text={node.item.text}
                trimCodeBlocks={node.item.role !== "assistant"}
                streaming={Boolean(node.item.live && !node.item.done)}
                linkBasePath={activeProject?.dir}
                {onOpenFile}
                onCopy={notifyCopyResult}
              />
            {/if}
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

  /* Brief opacity/transform settle when a live message becomes terminal.
   * Neutralized by the global prefers-reduced-motion rule in base.css. */
  .transcript-entry.state-settling {
    animation: transcript-state-settle 180ms ease-out;
  }
</style>
