<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Layers from "@lucide/svelte/icons/layers";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type { ConversationEntry, ConversationTreeNode, ToolCallRecord } from "$lib/api";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { writeClipboardText } from "$lib/core/clipboard";
  import { relativeTimeLabel } from "$lib/core/utils/time";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import { classifyHistoryEntry } from "./history-graph";
  import { HISTORY_ICONS, HISTORY_TONE_TEXT } from "./history-icons";
  import type { HistorySegment, HistorySelection, HistoryVisibleItem } from "./history-segments";

  type Props = {
    items: HistoryVisibleItem[];
    visibleIndexById: Map<string, number>;
    treeNodeIds: Set<string>;
    toolCallsById: Map<string, ToolCallRecord>;
    laneCount: number;
    hasConversation: boolean;
    rootActive: boolean;
    rootOnActivePath: boolean;
    expanded: Set<string>;
    selectedKey: string;
    onSelect: (selection: HistorySelection) => void;
    onToggleSegment: (id: string) => void;
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onEditEntry?: (entry: ConversationEntry) => void;
  };

  let {
    items,
    visibleIndexById,
    treeNodeIds,
    toolCallsById,
    laneCount,
    hasConversation,
    rootActive,
    rootOnActivePath,
    expanded,
    selectedKey,
    onSelect,
    onToggleSegment,
    onNavigateToEntry,
    onEditEntry,
  }: Props = $props();

  const ROW_H = 36;
  const LANE_W = 18;
  const PAD_X = 4;

  const rootRowOffset = $derived(hasConversation ? 1 : 0);
  const graphHeight = $derived((items.length + rootRowOffset) * ROW_H);
  const gutterWidth = $derived(laneCount * LANE_W + PAD_X * 2);
  const rootColor = $derived(rootOnActivePath ? "var(--primary)" : "var(--muted-foreground)");

  function laneX(lane: number): number {
    return PAD_X + lane * LANE_W + LANE_W / 2;
  }
  function rowY(rowIndex: number): number {
    return rowIndex * ROW_H + ROW_H / 2;
  }
  function entryRowY(rowIndex: number): number {
    return rowY(rowIndex + rootRowOffset);
  }

  type RailNode = {
    visibleIndex: number;
    lane: number;
    parentEntryId?: string;
    parentLane?: number;
    isOnActivePath: boolean;
    isActive: boolean;
    isLeaf: boolean;
    isSegment: boolean;
  };

  const nodes = $derived.by<RailNode[]>(() =>
    items.map((item, i) =>
      item.type === "entry"
        ? {
            visibleIndex: i,
            lane: item.row.lane,
            parentEntryId: item.row.node.entry.parentEntryId,
            parentLane: item.row.parentLane,
            isOnActivePath: item.row.isOnActivePath,
            isActive: item.row.isActive,
            isLeaf: item.row.isLeaf,
            isSegment: false,
          }
        : {
            visibleIndex: i,
            lane: item.segment.lane,
            parentEntryId: item.segment.headParentEntryId,
            parentLane: item.segment.headParentLane,
            isOnActivePath: item.segment.isOnActivePath,
            isActive: false,
            isLeaf: false,
            isSegment: true,
          },
    ),
  );

  type Edge = { d: string; active: boolean };
  const edges = $derived.by<Edge[]>(() => {
    const out: Edge[] = [];
    for (const node of nodes) {
      const parentId = node.parentEntryId;
      if (parentId === undefined || node.parentLane === undefined) continue;
      if (!treeNodeIds.has(parentId)) continue;
      const parentIndex = visibleIndexById.get(parentId);
      if (parentIndex === undefined) continue;
      const cx = laneX(node.lane);
      const cy = entryRowY(node.visibleIndex);
      const px = laneX(node.parentLane);
      const py = entryRowY(parentIndex);
      if (node.lane === node.parentLane) {
        out.push({ d: `M ${px} ${py} L ${cx} ${cy}`, active: node.isOnActivePath });
      } else {
        const turn = py + ROW_H;
        out.push({
          d: `M ${px} ${py} C ${px} ${py + ROW_H * 0.6} ${cx} ${py + ROW_H * 0.4} ${cx} ${turn} L ${cx} ${cy}`,
          active: node.isOnActivePath,
        });
      }
    }
    return out;
  });

  const rootEdges = $derived.by<Edge[]>(() => {
    if (!hasConversation) return [];
    const out: Edge[] = [];
    const rootX = laneX(0);
    const rY = rowY(0);
    for (const node of nodes) {
      const parentId = node.parentEntryId;
      if (parentId !== undefined && treeNodeIds.has(parentId)) continue;
      const cx = laneX(node.lane);
      const cy = entryRowY(node.visibleIndex);
      out.push({
        d:
          node.lane === 0
            ? `M ${rootX} ${rY} L ${cx} ${cy}`
            : `M ${rootX} ${rY} C ${rootX} ${rY + ROW_H * 0.6} ${cx} ${cy - ROW_H * 0.6} ${cx} ${cy}`,
        active: node.isOnActivePath,
      });
    }
    return out;
  });

  function segmentTitle(segment: HistorySegment): string {
    const parts = segment.parts.map((part) => `${part.count} ${part.label}`).join(", ");
    return `${segment.total} steps — ${parts}`;
  }

  function entryMenu(node: ConversationTreeNode): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: "Jump here", icon: ArrowRight, onSelect: () => onNavigateToEntry?.(node.entry.id) },
      {
        label: "Jump + summarize from here",
        icon: Sparkles,
        onSelect: () => onNavigateToEntry?.(node.entry.id, true),
      },
    ];
    if (node.entry.role === "user") {
      items.push({ label: "Edit & resend", icon: Pencil, onSelect: () => onEditEntry?.(node.entry) });
    }
    items.push(
      { type: "separator" },
      {
        label: "Copy entry id",
        icon: Copy,
        onSelect: async () => {
          try {
            await writeClipboardText(node.entry.id);
            notify.success("Copied entry id");
          } catch {
            notify.error("Could not copy to clipboard");
          }
        },
      },
    );
    return items;
  }
</script>

{#if hasConversation}
  <div class="relative" style={`min-height:${graphHeight}px`}>
    <svg
      class="pointer-events-none absolute left-0 top-0"
      width={gutterWidth}
      height={graphHeight}
      aria-hidden="true"
    >
      {#each rootEdges as edge, i (i)}
        <path
          d={edge.d}
          fill="none"
          stroke={edge.active ? "var(--primary)" : "var(--border)"}
          stroke-width={edge.active ? 2 : 1.5}
        />
      {/each}
      {#each edges as edge, i (i)}
        <path
          d={edge.d}
          fill="none"
          stroke={edge.active ? "var(--primary)" : "var(--border)"}
          stroke-width={edge.active ? 2 : 1.5}
        />
      {/each}
      {#if rootActive}
        <circle cx={laneX(0)} cy={rowY(0)} r={6.5} fill="none" stroke="var(--primary)" stroke-width={1.5} opacity={0.5} />
      {/if}
      <circle
        cx={laneX(0)}
        cy={rowY(0)}
        r={rootActive ? 4.5 : 4}
        fill={rootActive ? rootColor : "var(--background)"}
        stroke={rootColor}
        stroke-width={1.5}
      />
      {#each nodes as node (node.visibleIndex)}
        {@const cx = laneX(node.lane)}
        {@const cy = entryRowY(node.visibleIndex)}
        {@const color = node.isOnActivePath ? "var(--primary)" : "var(--muted-foreground)"}
        {#if node.isActive}
          <circle cx={cx} cy={cy} r={6.5} fill="none" stroke="var(--primary)" stroke-width={1.5} opacity={0.5} />
        {/if}
        {#if node.isSegment}
          <circle cx={cx} cy={cy} r={6} fill="var(--background)" stroke={color} stroke-width={1.5} stroke-dasharray="2 2" />
          <circle cx={cx} cy={cy} r={2} fill={color} />
        {:else}
          <circle
            cx={cx}
            cy={cy}
            r={node.isLeaf ? 4.5 : 4}
            fill={node.isLeaf || node.isActive ? color : "var(--background)"}
            stroke={color}
            stroke-width={1.5}
          />
        {/if}
      {/each}
    </svg>

    <div class="flex flex-col">
      <button
        class="relative flex w-full items-center gap-2 rounded-md pr-2 text-left transition-colors hover:bg-muted/60 data-[selected=true]:bg-muted data-[active=true]:bg-muted/70"
        data-active={rootActive}
        data-selected={selectedKey === "root"}
        style={`height:${ROW_H}px; padding-left:${gutterWidth + PAD_X}px`}
        type="button"
        title="Start a branch from the beginning"
        onclick={() => onSelect({ kind: "root" })}
        ondblclick={() => onNavigateToEntry?.(undefined)}
      >
        {#if rootActive}
          <span class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true"></span>
        {/if}
        <span
          class="flex size-5 shrink-0 items-center justify-center"
          class:text-primary={rootOnActivePath}
          class:text-muted-foreground={!rootOnActivePath}
        >
          <GitBranch class="size-4" strokeWidth={2} />
        </span>
        <span class="font-mono text-xs tabular-nums text-muted-foreground/50">00</span>
        <span class="truncate text-xs font-medium text-foreground">Start of conversation</span>
      </button>

      {#if items.length}
        {#each items as item (item.type === "entry" ? item.row.node.entry.id : `seg:${item.segment.id}`)}
          {#if item.type === "segment"}
            {@const isOpen = expanded.has(item.segment.id)}
            <button
              class="relative flex w-full items-center gap-2 rounded-md pr-2 text-left transition-colors hover:bg-muted/60 data-[selected=true]:bg-muted"
              class:opacity-55={!item.segment.isOnActivePath}
              data-selected={selectedKey === `s:${item.segment.id}`}
              style={`height:${ROW_H}px; padding-left:${gutterWidth + PAD_X}px`}
              type="button"
              title={segmentTitle(item.segment)}
              onclick={() => onSelect({ kind: "segment", segment: item.segment })}
            >
              <span class="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                <Layers class="size-4" strokeWidth={2} />
              </span>
              <span class="shrink-0 text-xs font-medium text-foreground">{item.segment.total} steps</span>
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {item.segment.parts.map((part) => `${part.count} ${part.label}`).join(" · ")}
              </span>
              <span
                role="button"
                tabindex="0"
                class="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                title={isOpen ? "Collapse steps" : "Expand steps"}
                aria-label={isOpen ? "Collapse steps" : "Expand steps"}
                onclick={(event) => {
                  event.stopPropagation();
                  onToggleSegment(item.segment.id);
                }}
                onkeydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleSegment(item.segment.id);
                  }
                }}
              >
                {#if isOpen}<ChevronDown class="size-4" strokeWidth={2} />{:else}<ChevronRight class="size-4" strokeWidth={2} />{/if}
              </span>
            </button>
          {:else}
            {@const row = item.row}
            {@const desc = classifyHistoryEntry(row.node.entry, toolCallsById)}
            {@const Icon = HISTORY_ICONS[desc.icon]}
            <ContextMenu items={entryMenu(row.node)} triggerClass="block w-full min-w-0">
              <button
                class="relative flex w-full items-center gap-2 rounded-md pr-2 text-left transition-colors hover:bg-muted/60 data-[selected=true]:bg-muted data-[active=true]:bg-muted/70"
                class:opacity-55={!row.isOnActivePath}
                data-active={row.isActive}
                data-selected={selectedKey === `e:${row.node.entry.id}`}
                style={`height:${ROW_H}px; padding-left:${gutterWidth + PAD_X}px`}
                type="button"
                title="Click to preview · double-click to jump"
                onclick={() => onSelect({ kind: "entry", row })}
                ondblclick={() => onNavigateToEntry?.(row.node.entry.id)}
              >
                {#if row.isActive}
                  <span class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true"></span>
                {/if}
                <span class={`flex size-5 shrink-0 items-center justify-center ${HISTORY_TONE_TEXT[desc.tone]}`}>
                  <Icon class="size-4" strokeWidth={2} />
                </span>
                <span class="font-mono text-xs tabular-nums text-muted-foreground/50">
                  {String(row.index).padStart(2, "0")}
                </span>
                <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{desc.label}</span>
                {#each desc.badges as badge, b (b)}
                  {@const BadgeIcon = HISTORY_ICONS[badge.icon]}
                  <span class={`flex shrink-0 items-center gap-0.5 ${HISTORY_TONE_TEXT[badge.tone]}`} title={badge.title ?? badge.label}>
                    <BadgeIcon class="size-3" strokeWidth={2} />
                  </span>
                {/each}
                <span class="shrink-0 font-mono text-xs text-muted-foreground/50">
                  {relativeTimeLabel(row.node.entry.createdAt)}
                </span>
              </button>
            </ContextMenu>
          {/if}
        {/each}
      {:else}
        <p class="px-1 py-4 text-center text-xs text-muted-foreground">No messages yet.</p>
      {/if}
    </div>
  </div>
{:else}
  <p class="px-1 py-6 text-center text-xs text-muted-foreground">No conversation history loaded.</p>
{/if}
