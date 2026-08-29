<script lang="ts">
import type {
  AgentRecord,
  ApprovalWithToolCall,
  ModelInfo,
  PlanReviewRecord,
  PlanReviewResolveOptions,
  ProjectRecord,
  UserQuestionRecord,
} from "../state/tool-types";
import type { ConversationMenuBuilders } from "../conversations/types.js";
import ToolCallCard from "../tools/ToolCallCard.svelte";
import ToolResultErrorCard from "../tools/tool-call/ToolResultErrorCard.svelte";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type { MermaidMarkdownBlock } from "@nervekit/ui-kit/renderers/mermaid/mermaid-blocks";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import CompactionCard from "./CompactionCard.svelte";
import UserMessageContent from "./UserMessageContent.svelte";
import TaskEventCard from "./TaskEventCard.svelte";
import RunStatusCard from "./RunStatusCard.svelte";
import ThinkingGroup from "./ThinkingGroup.svelte";
import type { TranscriptDisplayNode } from "./transcript-presentation";
import type { TranscriptEntranceMotion } from "./transcript-entry-motion";
import TranscriptContextMenu from "./TranscriptContextMenu.svelte";

type Props = {
  node: TranscriptDisplayNode;
  sending: boolean;
  activeProject?: ProjectRecord;
  approvalsByToolCallId?: ReadonlyMap<string, ApprovalWithToolCall>;
  questionsByToolCallId?: ReadonlyMap<string, UserQuestionRecord>;
  reviewsByToolCallId?: ReadonlyMap<string, PlanReviewRecord>;
  hydrateToolBodies?: boolean;
  entranceMotion?: TranscriptEntranceMotion;
  onClaimEntrance?: (token: string) => boolean;
  planReviewModels?: ModelInfo[];
  planReviewModelKey?: string;
  planReviewThinkingLevel?: AgentRecord["thinkingLevel"];
  lastTimelineKey?: string;
  onOpenFile?: (path: string, line?: number) => void;
  onOpenMermaid?: (block: MermaidMarkdownBlock, sourceKey: string) => void;
  onAnswerUserQuestion?: (questionId: string, answer: string) => void;
  onDismissUserQuestion?: (questionId: string) => void;
  onGrantApproval?: (
    id: string,
    scope?:
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ) => void | Promise<void>;
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
  transcriptMenu: ConversationMenuBuilders["transcriptMenu"];
};

let {
  node,
  sending,
  activeProject,
  approvalsByToolCallId = new Map(),
  questionsByToolCallId = new Map(),
  reviewsByToolCallId = new Map(),
  hydrateToolBodies = true,
  entranceMotion,
  onClaimEntrance,
  planReviewModels = [],
  planReviewModelKey = "",
  planReviewThinkingLevel = "off",
  lastTimelineKey,
  onOpenFile,
  onOpenMermaid,
  onAnswerUserQuestion,
  onDismissUserQuestion,
  onGrantApproval,
  onDenyApproval,
  onAcceptPlanReview,
  onAcceptPlanReviewInNewChat,
  onRejectPlanReview,
  onContinueFromFailure,
  transcriptMenu,
}: Props = $props();

const thinkingMenuTarget = $derived.by(() => {
  if (node.kind !== "thinking_group") return undefined;
  const first = node.items[0]?.item;
  if (!first) return undefined;
  return {
    kind: "thinking" as const,
    item: {
      ...first,
      text: node.items.map((member) => member.item.text).join("\n\n"),
    },
  };
});

const messageState = $derived.by<"running" | "complete" | "static">(() => {
  if (node.kind !== "message") return "static";
  const item = node.item;
  if (item.role === "assistant" && item.live) {
    return item.done ? "complete" : "running";
  }
  return "static";
});

// Markdown uses callback identity to retain its lazy Mermaid enhancement. Keep
// this handler stable so unrelated transcript updates do not remount diagrams.
function openMessageMermaid(block: MermaidMarkdownBlock): void {
  if (node.kind !== "message" || node.item.role !== "assistant") return;
  onOpenMermaid?.(block, node.item.liveMessageId ?? node.item.id ?? node.key);
}

let entering = $state(false);
let activeEntrance = $state<TranscriptEntranceMotion>();
let claimedEntranceToken: string | undefined;
$effect(() => {
  const motion = entranceMotion;
  if (!motion || motion.token === claimedEntranceToken) return;
  claimedEntranceToken = motion.token;
  if (onClaimEntrance?.(motion.token)) {
    activeEntrance = motion;
    entering = true;
  }
});
</script>

<div
  class="transcript-row-content"
  class:transcript-enter-standard={entering &&
    activeEntrance?.profile === "standard"}
  class:transcript-enter-compact={entering &&
    activeEntrance?.profile === "compact"}
  class:transcript-enter-minimal={entering &&
    activeEntrance?.profile === "minimal"}
  style:--transcript-enter-delay={activeEntrance
    ? `${activeEntrance.delayMs}ms`
    : undefined}
  onanimationend={(event) => {
    if (event.target !== event.currentTarget) return;
    entering = false;
    activeEntrance = undefined;
  }}
>
  {#if node.kind === "tool"}
    <div class="relative min-w-0 px-3">
      <!-- Keep one stable trigger across the whole tool lifecycle; it is inert
         (not removed) while only a draft exists, so the handoff to the real
         tool menu causes no layout shift. -->
      <TranscriptContextMenu
        target={node.toolCall
          ? {
              kind: "tool",
              anchorEntryId: node.anchorEntryId,
              toolCall: node.toolCall,
            }
          : {
              kind: "tool_result_error",
              toolName: node.draft?.block.toolName ?? "tool",
              error: "",
            }}
        menu={transcriptMenu}
        disabled={!node.toolCall}
        triggerClass="block min-w-0 select-text"
      >
        <ToolCallCard
          draft={node.draft}
          toolCall={node.toolCall}
          liveOutput={node.liveOutput}
          cwd={activeProject?.dir}
          pendingApproval={node.toolCall &&
          approvalsByToolCallId.get(node.toolCall.id)?.status === "pending"
            ? approvalsByToolCallId.get(node.toolCall.id)
            : undefined}
          pendingUserQuestion={node.toolCall
            ? questionsByToolCallId.get(node.toolCall.id)
            : undefined}
          hydrateBody={hydrateToolBodies}
          pendingPlanReview={node.toolCall
            ? reviewsByToolCallId.get(node.toolCall.id)
            : undefined}
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
      </TranscriptContextMenu>
    </div>
  {:else if node.kind === "tool_result_error"}
    <TranscriptContextMenu
      target={{
        kind: "tool_result_error",
        toolName: node.toolName,
        error: node.error,
      }}
      menu={transcriptMenu}
      triggerClass="block select-text"
    >
      <div class="relative min-w-0 px-3">
        <ToolResultErrorCard toolName={node.toolName} error={node.error} />
      </div>
    </TranscriptContextMenu>
  {:else if node.kind === "run_status"}
    <TranscriptContextMenu
      target={{ kind: "run_status", notice: node.notice }}
      menu={transcriptMenu}
      triggerClass="block select-text"
    >
      <RunStatusCard
        notice={node.notice}
        isLast={node.key === lastTimelineKey}
        {sending}
        {onContinueFromFailure}
      />
    </TranscriptContextMenu>
  {:else if node.kind === "compaction"}
    <TranscriptContextMenu
      target={{ kind: "compaction", notice: node.notice }}
      menu={transcriptMenu}
      triggerClass="block select-text"
    >
      <div class="relative min-w-0 px-3">
        <CompactionCard notice={node.notice} />
      </div>
    </TranscriptContextMenu>
  {:else if node.kind === "task_event"}
    <TranscriptContextMenu
      target={{ kind: "task_event", notice: node.notice }}
      menu={transcriptMenu}
      triggerClass="block select-text"
    >
      <TaskEventCard notice={node.notice} />
    </TranscriptContextMenu>
  {:else if node.kind === "thinking_group" && thinkingMenuTarget}
    <TranscriptContextMenu
      target={thinkingMenuTarget}
      menu={transcriptMenu}
      triggerClass="select-text"
    >
      <article
        class="transcript-entry assistant thinking-entry"
        data-state="static"
      >
        <div class="message-body">
          <ThinkingGroup items={node.items.map((member) => member.item)} />
        </div>
      </article>
    </TranscriptContextMenu>
  {:else if node.kind === "message"}
    <TranscriptContextMenu
      target={{ kind: "message", item: node.item }}
      menu={transcriptMenu}
      triggerClass={`select-text ${node.item.role === "user" ? "block" : ""}`}
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
                  onOpenMermaid={node.item.role === "assistant" && onOpenMermaid
                    ? openMessageMermaid
                    : undefined}
                  onCopy={notifyCopyResult}
                />
              {/if}
              {#if node.item.live && !node.item.done}<span
                  class="stream-caret"
                  aria-hidden="true"
                ></span>{/if}
            </div>
          {/if}
          {#if node.item.stopReason === "error" && node.item.errorMessage?.trim()}
            <pre
              class="mt-2 whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">{node.item.errorMessage.trim()}</pre>
          {/if}
        </div>
      </article>
    </TranscriptContextMenu>
  {/if}
</div>

<style>
.transcript-row-content {
  min-width: 0;
}

.transcript-entry {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 0.75rem;
  border-bottom: 0;
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
