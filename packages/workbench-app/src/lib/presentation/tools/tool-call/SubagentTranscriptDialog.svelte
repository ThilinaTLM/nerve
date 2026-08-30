<script lang="ts">
import type { SubagentTranscriptSnapshot } from "@nervekit/contracts/agents";
import type { EventEnvelope } from "@nervekit/contracts/events";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import { getConversationUiCapabilities } from "../../context.svelte";
import {
  applySubagentTranscriptEvent,
  fromSubagentTranscriptSnapshot,
} from "../../state/subagent-transcript-session";
import { buildConversationRenderProjection } from "../../state/render";
import type { ConversationRenderState } from "../../state/conversation-render-state";
import { createConversationScrollController } from "../../transcript/conversation-scroll.svelte.js";
import {
  groupConsecutiveThinking,
  type TranscriptDisplayNode,
} from "../../transcript/transcript-presentation";
import ThinkingGroup from "../../transcript/ThinkingGroup.svelte";
import UserMessageContent from "../../transcript/UserMessageContent.svelte";
import WorkingIndicator from "../../transcript/WorkingIndicator.svelte";
import ToolCallCard from "../ToolCallCard.svelte";
import ToolResultErrorCard from "./ToolResultErrorCard.svelte";

type DialogRow =
  | { kind: "timeline"; key: string; node: TranscriptDisplayNode }
  | { kind: "waiting"; key: string };

let {
  open = $bindable(false),
  parentAgentId,
  childAgentId,
  label,
  onOpenChange,
}: {
  open?: boolean;
  parentAgentId?: string;
  childAgentId?: string;
  label: string;
  onOpenChange?: (open: boolean) => void;
} = $props();

const capabilities = getConversationUiCapabilities();
let snapshot = $state<SubagentTranscriptSnapshot>();
let renderState = $state<ConversationRenderState>();
let loading = $state(false);
let error = $state<string>();
let retryKey = $state(0);

const projection = $derived(buildConversationRenderProjection(renderState));
const rows = $derived.by(() => {
  const timeline = groupConsecutiveThinking(projection.timeline).map(
    (node): DialogRow => ({ kind: "timeline", key: node.key, node }),
  );
  if (renderState?.sending && !projection.hasActiveTurnOutput) {
    timeline.push({ kind: "waiting", key: "__waiting__" });
  }
  return timeline;
});

const scroll = createConversationScrollController({
  active: () => open,
  conversationOpen: () => open,
  conversationId: () =>
    parentAgentId && childAgentId
      ? `subagent:${parentAgentId}:${childAgentId}`
      : undefined,
  contentReady: () => rows.length > 0,
});

function measurementVersion(row: DialogRow): string {
  if (row.kind === "waiting") return "waiting";
  const node = row.node;
  if (node.kind === "thinking_group") {
    return node.items
      .map(
        (member) =>
          `${member.item.text.length}:${member.item.done ? "done" : "open"}`,
      )
      .join("|");
  }
  if (node.kind === "message") {
    return [
      node.item.text.length,
      node.item.done ? "done" : "open",
      node.item.stopReason ?? "ok",
      node.item.errorMessage?.length ?? 0,
    ].join(":");
  }
  if (node.kind === "tool") {
    return node.toolCall
      ? `${node.toolCall.status}:${node.toolCall.updatedAt}`
      : `draft:${node.draft?.block.argsText.length ?? 0}`;
  }
  return node.key;
}

$effect(() => {
  const parent = parentAgentId;
  const child = childAgentId;
  const attempt = retryKey;
  if (!open || !parent || !child) return;
  const watch = capabilities.watchSubagentTranscript;
  if (!watch) {
    error = "Subagent transcripts are unavailable here.";
    return;
  }
  loading = !snapshot;
  error = undefined;
  const dispose = watch(parent, child, {
    snapshot: (next) => {
      if (next.parentAgentId !== parent || next.agentId !== child) return;
      snapshot = next;
      renderState = fromSubagentTranscriptSnapshot(next);
      loading = false;
      error = undefined;
    },
    event: (event: EventEnvelope<Record<string, unknown>>) => {
      if (!renderState) return;
      let gap = false;
      renderState = applySubagentTranscriptEvent(renderState, event, () => {
        gap = true;
        error = "Live activity was interrupted; recovering the transcript.";
      });
      return !gap;
    },
    error: (message) => {
      loading = false;
      error = message;
    },
  });
  void attempt;
  return dispose;
});

$effect(() => {
  const activeChildId = childAgentId;
  if (!activeChildId) return;
  snapshot = undefined;
  renderState = undefined;
  error = undefined;
});

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}
</script>

<DialogShell
  flush
  bind:open
  size="wide-viewport"
  title={`${label} transcript`}
  description={snapshot
    ? [snapshot.status, snapshot.model, snapshot.thinkingLevel]
        .filter(Boolean)
        .join(" · ")
    : "Read-only child-agent activity"}
  onOpenChange={handleOpenChange}
>
  {#if loading && !snapshot}
    <div class="grid gap-3 p-6" aria-label="Loading subagent transcript">
      <Skeleton class="h-16 w-3/4" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-20 w-4/5" />
    </div>
  {:else if error && !snapshot}
    <div class="grid place-items-center gap-3 p-8 text-center">
      <p class="m-0 text-sm text-destructive">{error}</p>
      <Button size="sm" variant="outline" onclick={() => (retryKey += 1)}
        >Retry</Button
      >
    </div>
  {:else if snapshot}
    <div class="grid h-full min-h-0 grid-rows-[auto_1fr]">
      {#if snapshot.entriesTruncated || snapshot.toolCallsTruncated || error}
        <div
          class="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
        >
          {#if snapshot.entriesTruncated || snapshot.toolCallsTruncated}
            Showing the assignment and most recent bounded activity.
          {/if}
          {#if error}
            <span class="text-destructive"> {error}</span>
          {/if}
        </div>
      {/if}
      {#if rows.length === 0}
        <div class="grid place-items-center p-8 text-sm text-muted-foreground">
          No transcript activity yet.
        </div>
      {:else}
        <div class="relative min-h-0">
          <VirtualScroller
            bind:controller={scroll.controller}
            bind:atEnd={scroll.atEnd}
            items={rows}
            getKey={(row) => row.key}
            heightCacheKey={parentAgentId && childAgentId
              ? `subagent-transcript:${parentAgentId}:${childAgentId}`
              : undefined}
            getMeasurementVersion={measurementVersion}
            estimateSize={() => 112}
            overscan={10}
            anchor="end"
            followOutput={scroll.followBottom}
            scrollEndThreshold={32}
            paddingStart={12}
            paddingEnd={12}
            gap={2}
            viewportTabIndex={0}
            viewportAriaLabel={`${label} subagent transcript`}
            viewportClass="h-full px-3"
          >
            {#snippet row({ item: row })}
              {#if row.kind === "waiting"}
                <article class="relative w-full min-w-0 p-3 text-sm">
                  <WorkingIndicator />
                </article>
              {:else if row.node.kind === "tool" && row.node.toolCall}
                <div class="min-w-0 px-3">
                  <ToolCallCard
                    toolCall={row.node.toolCall}
                    detailsEnabled={false}
                  />
                </div>
              {:else if row.node.kind === "tool_result_error"}
                <div class="min-w-0 px-3">
                  <ToolResultErrorCard
                    toolName={row.node.toolName}
                    error={row.node.error}
                  />
                </div>
              {:else if row.node.kind === "thinking_group"}
                <article class="min-w-0 p-3 text-sm">
                  <ThinkingGroup
                    items={row.node.items.map((member) => member.item)}
                  />
                </article>
              {:else if row.node.kind === "message"}
                <article
                  class="min-w-0 p-3 text-sm {row.node.item.role === 'user'
                    ? 'ml-auto w-fit max-w-[70%] rounded-lg rounded-br-sm border border-primary/20 bg-primary/10 px-3 py-2'
                    : 'w-full'}"
                >
                  {#if row.node.item.role === "user"}
                    <UserMessageContent
                      text={row.node.item.text}
                      pending={false}
                    />
                  {:else}
                    <Markdown
                      text={row.node.item.text}
                      trimCodeBlocks={row.node.item.role !== "assistant"}
                      onCopy={notifyCopyResult}
                    />
                  {/if}
                  {#if row.node.item.stopReason === "error" && row.node.item.errorMessage}
                    <pre
                      class="mt-2 whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">{row
                        .node.item.errorMessage}</pre>
                  {/if}
                </article>
              {/if}
            {/snippet}
          </VirtualScroller>
          {#if !scroll.atEnd}
            <Button
              size="icon-sm"
              variant="secondary"
              class="absolute right-5 bottom-4 rounded-full shadow-md"
              onclick={() => scroll.jumpToBottom()}
              aria-label="Jump to latest subagent activity"
              title="Jump to latest"
            >
              <ArrowDown class="size-4" aria-hidden="true" />
            </Button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</DialogShell>
