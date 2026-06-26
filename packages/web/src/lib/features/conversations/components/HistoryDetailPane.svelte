<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Copy from "@lucide/svelte/icons/copy";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
  import type { ConversationEntry, ToolCallTranscriptRecord } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import Markdown from "$lib/core/components/Markdown.svelte";
  import PlainText from "$lib/core/components/PlainText.svelte";
  import { writeClipboardText } from "$lib/core/clipboard";
  import { dateTimeLabel, relativeTimeLabel } from "$lib/core/utils/time";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import {
    classifyHistoryEntry,
    parseToolCallNames,
    resolveToolCallForEntry,
    type HistoryGraphRow,
  } from "./history-graph";
  import { HISTORY_ICONS, HISTORY_TONE_TEXT } from "./history-icons";
  import type { HistorySelection } from "./history-segments";

  type Props = {
    selection?: HistorySelection;
    toolCallsById: Map<string, ToolCallTranscriptRecord>;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onEditEntry?: (entry: ConversationEntry) => void;
    onSelectRow?: (row: HistoryGraphRow) => void;
    onExpandSegment?: (id: string) => void;
  };

  let {
    selection,
    toolCallsById,
    onNavigateToEntry,
    onEditEntry,
    onSelectRow,
    onExpandSegment,
  }: Props = $props();

  const entry = $derived(selection?.kind === "entry" ? selection.row.node.entry : undefined);
  const desc = $derived(entry ? classifyHistoryEntry(entry, toolCallsById) : undefined);
  const record = $derived(entry ? resolveToolCallForEntry(entry, toolCallsById) : undefined);

  function thinkingText(value: ConversationEntry): string {
    const details = value.details as { thinkingBlocks?: { text?: string }[] } | undefined;
    const blocks = details?.thinkingBlocks;
    if (!Array.isArray(blocks)) return "";
    return blocks
      .map((block) => block?.text ?? "")
      .filter(Boolean)
      .join("\n\n");
  }

  function pretty(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  const isToolEntry = $derived(
    desc?.type === "tool_call" || desc?.type === "tool_result" || desc?.type === "human_loop",
  );
  const toolName = $derived(
    record?.toolName ??
      (entry ? parseToolCallNames(entry.text)[0] : undefined) ??
      (entry?.details as { toolName?: string } | undefined)?.toolName,
  );
  const hasArgs = $derived(
    record?.argsPreview !== undefined &&
      record?.argsPreview !== null &&
      Object.keys(record.argsPreview as object).length > 0,
  );
  const resultText = $derived(
    entry?.role === "system"
      ? entry.text
      : typeof record?.resultPreview === "string"
        ? record.resultPreview
        : "",
  );

  async function copyId(id: string) {
    try {
      await writeClipboardText(id);
      notify.success("Copied entry id");
    } catch {
      notify.error("Could not copy to clipboard");
    }
  }
</script>

{#if !selection}
  <div class="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
    Select an entry on the left to preview it here.
  </div>
{:else if selection.kind === "root"}
  <div class="flex flex-col gap-4 p-5">
    <div class="flex items-center gap-2 text-primary">
      <GitBranch class="size-5" strokeWidth={2} />
      <h3 class="text-sm font-semibold text-foreground">Start of conversation</h3>
    </div>
    <p class="text-sm text-muted-foreground">
      Jump here to fork a brand-new branch from the very beginning. Your next message becomes the
      first entry of that branch; the existing history stays available in the tree.
    </p>
    <div>
      <Button size="sm" onclick={() => onNavigateToEntry?.(undefined)}>
        <GitBranch class="size-4" strokeWidth={2} />
        New branch from beginning
      </Button>
    </div>
  </div>
{:else if selection.kind === "segment"}
  {@const segment = selection.segment}
  <div class="flex flex-col gap-4 p-5">
    <div class="flex flex-col gap-1">
      <h3 class="text-sm font-semibold text-foreground">{segment.total} collapsed steps</h3>
      <p class="text-xs text-muted-foreground">
        {dateTimeLabel(segment.startedAt)} — {dateTimeLabel(segment.endedAt)}
      </p>
    </div>
    <div class="flex flex-wrap gap-1.5">
      {#each segment.parts as part, i (i)}
        {@const PartIcon = HISTORY_ICONS[part.icon]}
        <span class="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
          <PartIcon class="size-3.5" strokeWidth={2} />
          <span class="font-medium text-foreground">{part.count}</span>
          {part.label}
        </span>
      {/each}
    </div>
    <div class="flex">
      <Button variant="outline" size="sm" onclick={() => onExpandSegment?.(segment.id)}>
        <UnfoldVertical class="size-4" strokeWidth={2} />
        Expand in tree
      </Button>
    </div>
    <div class="flex flex-col gap-0.5 border-t pt-3">
      {#each segment.rows as row (row.node.entry.id)}
        {@const stepDesc = classifyHistoryEntry(row.node.entry, toolCallsById)}
        {@const StepIcon = HISTORY_ICONS[stepDesc.icon]}
        <button
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
          type="button"
          onclick={() => onSelectRow?.(row)}
        >
          <span class={`flex size-4 shrink-0 items-center justify-center ${HISTORY_TONE_TEXT[stepDesc.tone]}`}>
            <StepIcon class="size-3.5" strokeWidth={2} />
          </span>
          <span class="shrink-0 text-xs font-medium text-foreground">{stepDesc.label}</span>
          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground" class:font-mono={stepDesc.mono}>
            {stepDesc.preview}
          </span>
        </button>
      {/each}
    </div>
  </div>
{:else if entry && desc}
  {@const Icon = HISTORY_ICONS[desc.icon]}
  {@const thinking = thinkingText(entry)}
  <div class="flex h-full flex-col">
    <div class="flex flex-col gap-3 border-b p-5">
      <div class="flex items-center gap-2">
        <span class={`flex size-5 shrink-0 items-center justify-center ${HISTORY_TONE_TEXT[desc.tone]}`}>
          <Icon class="size-5" strokeWidth={2} />
        </span>
        <h3 class="text-sm font-semibold text-foreground">{desc.label}</h3>
        {#each desc.badges as badge, b (b)}
          {@const BadgeIcon = HISTORY_ICONS[badge.icon]}
          <span class={`flex items-center gap-0.5 text-xs ${HISTORY_TONE_TEXT[badge.tone]}`} title={badge.title ?? badge.label}>
            <BadgeIcon class="size-3.5" strokeWidth={2} />
            {#if badge.label}{badge.label}{/if}
          </span>
        {/each}
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span title={dateTimeLabel(entry.createdAt)}>{relativeTimeLabel(entry.createdAt)} ago</span>
        {#if entry.usage?.totalTokens}
          <span class="flex items-center gap-1">
            <Sparkles class="size-3.5" strokeWidth={2} />
            {entry.usage.totalTokens.toLocaleString()} tokens
          </span>
        {/if}
        <button
          class="flex items-center gap-1 font-mono hover:text-foreground"
          type="button"
          title="Copy entry id"
          onclick={() => copyId(entry.id)}
        >
          <Copy class="size-3" strokeWidth={2} />
          {entry.id}
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" onclick={() => onNavigateToEntry?.(entry.id)}>
          <ArrowRight class="size-4" strokeWidth={2} />
          Jump here
        </Button>
        <Button variant="outline" size="sm" onclick={() => onNavigateToEntry?.(entry.id, true)}>
          <Sparkles class="size-4" strokeWidth={2} />
          Jump + summarize
        </Button>
        {#if entry.role === "user"}
          <Button variant="outline" size="sm" onclick={() => onEditEntry?.(entry)}>
            <Pencil class="size-4" strokeWidth={2} />
            Edit & resend
          </Button>
        {/if}
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-5">
      {#if isToolEntry}
        <div class="flex flex-col gap-3">
          {#if toolName}
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">Tool</span>
              <span class="font-mono">{toolName}</span>
              {#if record?.status}<span class="rounded-full border px-1.5 py-0.5">{record.status}</span>{/if}
            </div>
          {/if}
          {#if hasArgs}
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium text-muted-foreground">Arguments</span>
              <pre class="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">{pretty(record?.argsPreview)}</pre>
            </div>
          {/if}
          {#if resultText}
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium text-muted-foreground">Result</span>
              <pre class="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">{resultText}</pre>
            </div>
          {/if}
          {#if record?.error}
            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium text-destructive">Error</span>
              <pre class="overflow-x-auto rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs whitespace-pre-wrap break-words">{record.error}</pre>
            </div>
          {/if}
          {#if !hasArgs && !resultText && !record?.error}
            <p class="text-xs text-muted-foreground">No tool details available for this entry.</p>
          {/if}
        </div>
      {:else if thinking && !entry.text}
        <div class="text-sm text-muted-foreground">
          <Markdown text={thinking} />
        </div>
      {:else if entry.summary || entry.text}
        <div class="text-sm text-foreground">
          {#if entry.role === "user"}
            <PlainText text={entry.summary || entry.text} />
          {:else}
            <Markdown text={entry.summary || entry.text} trimCodeBlocks={entry.role !== "assistant"} />
          {/if}
        </div>
        {#if thinking}
          <div class="mt-4 border-t pt-3 text-sm text-muted-foreground">
            <span class="mb-1 block text-xs font-medium">Thinking</span>
            <Markdown text={thinking} />
          </div>
        {/if}
      {:else}
        <p class="text-xs text-muted-foreground">This entry has no text content.</p>
      {/if}
    </div>
  </div>
{/if}
