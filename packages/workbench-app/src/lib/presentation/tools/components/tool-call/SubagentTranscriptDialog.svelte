<script lang="ts">
import type {
  ConversationEntry,
  SubagentTranscriptSnapshot,
} from "@nervekit/contracts";
import DialogShell from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/ui/virtual-list";
import Markdown from "@nervekit/ui-kit/core/components/Markdown.svelte";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import { getConversationUiCapabilities } from "../../../context.svelte";
import { entriesToTranscript } from "../../../state/transcript";
import { buildCommittedTimeline } from "../../../state/timeline";
import { groupConsecutiveThinking } from "../../../components/transcript/transcript-presentation";
import ThinkingGroup from "../../../components/transcript/ThinkingGroup.svelte";
import UserMessageContent from "../../../components/transcript/UserMessageContent.svelte";
import ToolCallCard from "../ToolCallCard.svelte";
import ToolResultErrorCard from "./ToolResultErrorCard.svelte";

let {
  open = $bindable(false),
  parentAgentId,
  childAgentId,
  label,
  revision,
  running = false,
  onOpenChange,
}: {
  open?: boolean;
  parentAgentId?: string;
  childAgentId?: string;
  label: string;
  revision: string;
  running?: boolean;
  onOpenChange?: (open: boolean) => void;
} = $props();

const capabilities = getConversationUiCapabilities();
let snapshot = $state<SubagentTranscriptSnapshot>();
let loading = $state(false);
let error = $state<string>();
let requestVersion = 0;
let loadedKey: string | undefined;
let controller = $state<VirtualScrollerController>();

const timeline = $derived.by(() => {
  if (!snapshot) return [];
  const transcript = entriesToTranscript(
    snapshot.entries as ConversationEntry[],
  );
  return groupConsecutiveThinking(
    buildCommittedTimeline(transcript, snapshot.toolCalls, {
      includeHiddenToolCalls: true,
      includeUnanchoredTerminalToolCalls: true,
    }).items,
  );
});

async function load(force = false, revisionKey = revision) {
  if (!parentAgentId || !childAgentId) return;
  const key = `${parentAgentId}:${childAgentId}:${revisionKey}`;
  if (!force && snapshot && loadedKey === key) return;
  const fetchTranscript = capabilities.fetchSubagentTranscript;
  if (!fetchTranscript) {
    error = "Subagent transcripts are unavailable here.";
    return;
  }
  const version = ++requestVersion;
  loading = !snapshot;
  error = undefined;
  try {
    const next = await fetchTranscript(parentAgentId, childAgentId);
    if (version !== requestVersion || !open) return;
    snapshot = next;
    loadedKey = key;
  } catch (caught) {
    if (version !== requestVersion || !open) return;
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (version === requestVersion) loading = false;
  }
}

$effect(() => {
  if (!open || !childAgentId || !parentAgentId) return;
  const refreshRevision = revision;
  const delay = snapshot && running ? 900 : 0;
  const timer = setTimeout(() => void load(false, refreshRevision), delay);
  return () => clearTimeout(timer);
});

$effect(() => {
  const activeChildId = childAgentId;
  if (!activeChildId) return;
  requestVersion += 1;
  snapshot = undefined;
  loadedKey = undefined;
  error = undefined;
});

function handleOpenChange(next: boolean) {
  open = next;
  if (!next) requestVersion += 1;
  onOpenChange?.(next);
}
</script>

<DialogShell
  flush
  bind:open
  size="viewport"
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
      <Button size="sm" variant="outline" onclick={() => void load(true)}
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
            <span class="text-destructive"> Refresh failed: {error}</span>
          {/if}
        </div>
      {/if}
      {#if timeline.length === 0}
        <div class="grid place-items-center p-8 text-sm text-muted-foreground">
          No transcript activity yet.
        </div>
      {:else}
        <VirtualScroller
          bind:controller
          items={timeline}
          getKey={(node) => node.key}
          estimateSize={() => 112}
          overscan={8}
          anchor="end"
          followOutput={true}
          paddingStart={12}
          paddingEnd={12}
          gap={2}
          viewportTabIndex={0}
          viewportAriaLabel={`${label} subagent transcript`}
          viewportClass="h-full px-3"
        >
          {#snippet row({ item: node })}
            {#if node.kind === "tool" && node.toolCall}
              <div class="min-w-0 px-3">
                <ToolCallCard toolCall={node.toolCall} detailsEnabled={false} />
              </div>
            {:else if node.kind === "tool_result_error"}
              <div class="min-w-0 px-3">
                <ToolResultErrorCard
                  toolName={node.toolName}
                  error={node.error}
                />
              </div>
            {:else if node.kind === "thinking_group"}
              <article class="min-w-0 p-3 text-sm">
                <ThinkingGroup
                  items={node.items.map((member) => member.item)}
                />
              </article>
            {:else if node.kind === "message"}
              <article
                class="min-w-0 p-3 text-sm {node.item.role === 'user'
                  ? 'ml-auto w-fit max-w-[70%] rounded-lg rounded-br-sm border border-primary/20 bg-primary/10 px-3 py-2'
                  : 'w-full'}"
              >
                {#if node.item.role === "user"}
                  <UserMessageContent text={node.item.text} pending={false} />
                {:else}
                  <Markdown
                    text={node.item.text}
                    trimCodeBlocks={node.item.role !== "assistant"}
                    onCopy={notifyCopyResult}
                  />
                {/if}
                {#if node.item.stopReason === "error" && node.item.errorMessage}
                  <pre
                    class="mt-2 whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">{node
                      .item.errorMessage}</pre>
                {/if}
              </article>
            {/if}
          {/snippet}
        </VirtualScroller>
      {/if}
    </div>
  {/if}
</DialogShell>
