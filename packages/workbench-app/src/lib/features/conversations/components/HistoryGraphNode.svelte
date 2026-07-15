<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Copy from "@lucide/svelte/icons/copy";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Pencil from "@lucide/svelte/icons/pencil";
import Sparkles from "@lucide/svelte/icons/sparkles";
import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
import { Handle, Position, type NodeProps } from "@xyflow/svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import { writeClipboardText } from "$lib/core/clipboard";
import { relativeTimeLabel } from "$lib/core/utils/time";
import { notify } from "$lib/features/notifications/notify.svelte";
import type {
  HistoryEntryNodeData,
  HistoryFlowNode,
  HistoryFlowNodeData,
} from "./history-flow";
import { HISTORY_ICONS, HISTORY_TONE_TEXT } from "./history-icons";

type Props = NodeProps<HistoryFlowNode>;

let { data, selected }: Props = $props();

const cardClass = $derived(
  data.kind === "entry"
    ? "h-48 w-80"
    : data.kind === "segment"
      ? "h-28 w-72"
      : "h-20 w-64",
);

function stop(event: MouseEvent) {
  event.stopPropagation();
}

async function copyId(id: string) {
  try {
    await writeClipboardText(id);
    notify.success("Copied entry id");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

function entryMenu(entryData: HistoryEntryNodeData): ContextMenuItem[] {
  const entry = entryData.row.node.entry;
  const items: ContextMenuItem[] = [
    {
      label: "Jump here",
      icon: ArrowRight,
      onSelect: () => entryData.actions?.onNavigateToEntry?.(entry.id),
    },
    {
      label: "Jump + summarize from here",
      icon: Sparkles,
      onSelect: () => entryData.actions?.onNavigateToEntry?.(entry.id, true),
    },
  ];
  if (entry.role === "user") {
    items.push({
      label: "Edit & resend",
      icon: Pencil,
      onSelect: () => entryData.actions?.onEditEntry?.(entry),
    });
  }
  items.push(
    { type: "separator" },
    {
      label: "Copy entry id",
      icon: Copy,
      onSelect: () => copyId(entry.id),
    },
  );
  return items;
}

function jump(data: HistoryFlowNodeData, summarize = false) {
  if (data.kind === "entry") {
    data.actions?.onNavigateToEntry?.(data.row.node.entry.id, summarize);
  } else if (data.kind === "root") {
    data.actions?.onNavigateToEntry?.(undefined, summarize);
  }
}
</script>

{#snippet card()}
  <div
    class={`relative flex ${cardClass} cursor-pointer flex-col overflow-hidden rounded-lg border bg-card text-foreground shadow-sm transition-[border-color,box-shadow,opacity]`}
    class:border-primary={data.isOnActivePath}
    class:border-border={!data.isOnActivePath}
    class:ring-2={selected}
    class:ring-ring={selected}
    class:opacity-65={!data.isOnActivePath && !selected}
    role="group"
    ondblclick={() => jump(data)}
  >
    {#if data.kind !== "root"}
      <Handle type="target" position={Position.Top} isConnectable={false} />
    {/if}

    {#if data.zoomTier === "overview"}
      <div class="flex h-full items-center justify-center">
        {#if data.kind === "entry"}
          {@const OverviewIcon = HISTORY_ICONS[data.view.descriptor.icon]}
          <span
            class={`flex size-10 items-center justify-center rounded-full border bg-card ${HISTORY_TONE_TEXT[data.view.descriptor.tone]}`}
          >
            <OverviewIcon class="size-5" strokeWidth={2} />
          </span>
        {:else if data.kind === "segment"}
          <span
            class="flex size-10 items-center justify-center rounded-full border border-dashed bg-card text-muted-foreground"
          >
            <UnfoldVertical class="size-5" strokeWidth={2} />
          </span>
        {:else}
          <span
            class="flex size-10 items-center justify-center rounded-full border bg-card text-primary"
          >
            <GitBranch class="size-5" strokeWidth={2} />
          </span>
        {/if}
      </div>
    {:else if data.kind === "root"}
      <div class="flex h-full items-center gap-3 px-4">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <GitBranch class="size-4" strokeWidth={2} />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-semibold">Start of conversation</p>
          <p class="truncate text-xs text-muted-foreground">
            Fork a new branch from the beginning
          </p>
        </div>
      </div>
    {:else if data.kind === "segment"}
      <div class="flex h-full flex-col justify-center gap-2 px-4 py-3">
        <div class="flex items-center gap-2">
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"
          >
            <UnfoldVertical class="size-4" strokeWidth={2} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">
              {data.segment.total} collapsed steps
            </p>
            <p class="truncate text-xs text-muted-foreground">
              {data.segment.parts
                .map((part) => `${part.count} ${part.label}`)
                .join(" · ")}
            </p>
          </div>
          <Button
            class="nodrag nopan"
            variant="ghost"
            size="icon-xs"
            ariaLabel="Expand collapsed steps"
            title="Expand collapsed steps"
            onclick={(event) => {
              stop(event);
              data.actions?.onToggleSegment(data.segment);
            }}
          >
            <UnfoldVertical class="size-3.5" strokeWidth={2} />
          </Button>
        </div>
        {#if data.zoomTier === "detail"}
          <div class="flex flex-wrap gap-1 overflow-hidden">
            {#each data.segment.parts.slice(0, 4) as part (part.label)}
              <span
                class="rounded-full border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground"
                >{part.count} {part.label}</span
              >
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      {@const desc = data.view.descriptor}
      {@const Icon = HISTORY_ICONS[desc.icon]}
      <div class="flex items-center gap-2 border-b px-3 py-2.5">
        <span
          class={`flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50 ${HISTORY_TONE_TEXT[desc.tone]}`}
        >
          <Icon class="size-4" strokeWidth={2} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-xs text-muted-foreground/60">
              {String(data.row.index).padStart(2, "0")}
            </span>
            <p class="truncate text-sm font-semibold">{desc.label}</p>
            {#each desc.badges as badge, index (index)}
              {@const BadgeIcon = HISTORY_ICONS[badge.icon]}
              <span
                class={`flex shrink-0 items-center gap-0.5 text-xs ${HISTORY_TONE_TEXT[badge.tone]}`}
                title={badge.title ?? badge.label}
              >
                <BadgeIcon class="size-3" strokeWidth={2} />
                {#if badge.label}{badge.label}{/if}
              </span>
            {/each}
          </div>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{relativeTimeLabel(data.row.node.entry.createdAt)} ago</span>
            {#if data.view.record?.status}
              <span class="truncate font-mono">{data.view.record.status}</span>
            {/if}
          </div>
        </div>
      </div>

      <div class="min-h-0 flex-1 px-3 py-2.5">
        {#if data.zoomTier === "detail"}
          <pre
            class="line-clamp-5 font-sans text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground"
            class:font-mono={desc.mono}>{data.view.detailPreview}</pre>
        {:else}
          <p
            class="line-clamp-3 text-xs leading-relaxed text-muted-foreground"
            class:font-mono={desc.mono}
          >
            {desc.preview || "No preview available"}
          </p>
        {/if}
      </div>

      {#if data.zoomTier === "detail"}
        <div class="flex items-center justify-end gap-1 border-t px-2 py-1.5">
          <Button
            class="nodrag nopan"
            variant="ghost"
            size="icon-xs"
            ariaLabel="Jump here"
            title="Jump here"
            onclick={(event) => {
              stop(event);
              jump(data);
            }}
          >
            <ArrowRight class="size-3.5" strokeWidth={2} />
          </Button>
          <Button
            class="nodrag nopan"
            variant="ghost"
            size="icon-xs"
            ariaLabel="Jump and summarize"
            title="Jump and summarize"
            onclick={(event) => {
              stop(event);
              jump(data, true);
            }}
          >
            <Sparkles class="size-3.5" strokeWidth={2} />
          </Button>
          {#if data.row.node.entry.role === "user"}
            <Button
              class="nodrag nopan"
              variant="ghost"
              size="icon-xs"
              ariaLabel="Edit and resend"
              title="Edit and resend"
              onclick={(event) => {
                stop(event);
                data.actions?.onEditEntry?.(data.row.node.entry);
              }}
            >
              <Pencil class="size-3.5" strokeWidth={2} />
            </Button>
          {/if}
        </div>
      {/if}
    {/if}

    {#if data.kind === "root" || data.kind === "segment" || (data.kind === "entry" && !data.row.isLeaf)}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    {/if}
  </div>
{/snippet}

{#if data.kind === "entry"}
  <ContextMenu items={entryMenu(data)} triggerClass="block h-full w-full">
    {@render card()}
  </ContextMenu>
{:else}
  {@render card()}
{/if}
