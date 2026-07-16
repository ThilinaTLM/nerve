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
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import ToolCallCard from "../../tools/components/ToolCallCard.svelte";
import ToolResultErrorCard from "../../tools/components/tool-call/ToolResultErrorCard.svelte";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import type { TranscriptItem } from "../../state/transcript-types";
import CompactionCard from "./CompactionCard.svelte";
import UserMessageContent from "./UserMessageContent.svelte";
import TaskEventCard from "./TaskEventCard.svelte";
import RunStatusCard from "./RunStatusCard.svelte";
import ThinkingGroup from "./ThinkingGroup.svelte";
import type { TranscriptDisplayNode } from "./transcript-presentation";

type Props = {
  node: TranscriptDisplayNode;
  sending: boolean;
  activeProject?: ProjectRecord;
  approvals?: ApprovalWithToolCall[];
  pendingUserQuestion?: UserQuestionRecord;
  pendingPlanReview?: PlanReviewRecord;
  hydrateToolBodies?: boolean;
  entranceToken?: string;
  onClaimEntrance?: (token: string) => boolean;
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
  onRejectPlanReview?: (id: string) => void | Promise<void>;
  onContinueFromFailure?: (runId: string) => void;
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
  entranceToken,
  onClaimEntrance,
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

const messageMenuItems = $derived.by(() => {
  if (node.kind === "message") return messageMenu(node.item);
  if (node.kind === "thinking_group") {
    const first = node.items[0]?.item;
    if (!first) return [];
    // Menu actions (copy, etc.) should act on the whole reasoning group.
    return messageMenu({
      ...first,
      text: node.items.map((member) => member.item.text).join("\n\n"),
    });
  }
  return [];
});

const messageState = $derived.by<"running" | "complete" | "static">(() => {
  if (node.kind !== "message") return "static";
  const item = node.item;
  if (item.role === "assistant" && item.live) {
    return item.done ? "complete" : "running";
  }
  return "static";
});

let entering = $state(false);
let claimedEntranceToken: string | undefined;
$effect(() => {
  const token = entranceToken;
  if (!token || token === claimedEntranceToken) return;
  claimedEntranceToken = token;
  if (onClaimEntrance?.(token)) entering = true;
});
</script>

<div
  class="transcript-row-content"
  class:live-entering={entering}
  onanimationend={(event) => {
    if (event.target === event.currentTarget) entering = false;
  }}
>
  {#if node.kind === "tool"}
    <div class="relative min-w-0 px-3">
      <!-- Keep one stable trigger across the whole tool lifecycle; it is inert
         (not removed) while only a draft exists, so the handoff to the real
         tool menu causes no layout shift. -->
      <ContextMenu
        items={node.toolCall ? toolMenu(node.anchorEntryId, node.toolCall) : []}
        disabled={!node.toolCall}
        triggerClass="block min-w-0"
      >
        <ToolCallCard
          draft={node.draft}
          toolCall={node.toolCall}
          liveOutput={node.liveOutput}
          cwd={activeProject?.dir}
          pendingApproval={node.toolCall
            ? approvals.find(
                (approval) =>
                  approval.toolCallId === node.toolCall?.id &&
                  approval.status === "pending",
              )
            : undefined}
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
    </div>
  {:else if node.kind === "tool_result_error"}
    <div class="relative min-w-0 px-3">
      <ToolResultErrorCard toolName={node.toolName} error={node.error} />
    </div>
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
  {:else if node.kind === "thinking_group"}
    <ContextMenu items={messageMenuItems} triggerClass="select-text">
      <article
        class="transcript-entry assistant thinking-entry"
        data-state="static"
      >
        <div class="message-body">
          <ThinkingGroup items={node.items.map((member) => member.item)} />
        </div>
      </article>
    </ContextMenu>
  {:else}
    <ContextMenu
      items={messageMenuItems}
      triggerClass={`select-text ${node.item.role === "user" ? "user-msg-trigger" : ""}`}
    >
      <article
        class={`transcript-entry ${node.item.role} ${node.item.live ? "streaming" : ""}`}
        data-state={messageState}
      >
        <div class="message-body">
          {#if node.item.text}
            <div class="message-content">
              {#if node.item.role === "user"}
                <UserMessageContent
                  text={node.item.text}
                  pending={Boolean(node.item.optimistic)}
                />
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
</div>

<style>
.transcript-row-content {
  min-width: 0;
}

.transcript-row-content.live-entering {
  animation: transcript-live-enter 180ms ease-out;
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

@container (max-width: 40rem) {
  .transcript-entry.user {
    max-width: 88%;
  }
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
