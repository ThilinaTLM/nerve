<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Bot from "@lucide/svelte/icons/bot";
  import Brain from "@lucide/svelte/icons/brain";
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import Cpu from "@lucide/svelte/icons/cpu";
  import Download from "@lucide/svelte/icons/download";
  import FilePen from "@lucide/svelte/icons/file-pen";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FileText from "@lucide/svelte/icons/file-text";
  import FoldVertical from "@lucide/svelte/icons/fold-vertical";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import FolderTree from "@lucide/svelte/icons/folder-tree";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Globe from "@lucide/svelte/icons/globe";
  import Hand from "@lucide/svelte/icons/hand";
  import Info from "@lucide/svelte/icons/info";
  import ListTodo from "@lucide/svelte/icons/list-todo";
  import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Search from "@lucide/svelte/icons/search";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import User from "@lucide/svelte/icons/user";
  import Wrench from "@lucide/svelte/icons/wrench";
  import type { Component } from "svelte";
  import { toast } from "svelte-sonner";
  import type { ConversationEntry, ConversationRecord, ConversationTreeNode, ToolCallRecord } from "../../../api";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ui/context-menu-list";
  import { relativeTimeLabel } from "$lib/utils/time";
  import {
    buildHistoryGraph,
    classifyHistoryEntry,
    type HistoryIconName,
    type HistoryTone,
  } from "./history-graph";

  type Props = {
    activeConversation?: ConversationRecord;
    treeNodes?: ConversationTreeNode[];
    toolCalls?: ToolCallRecord[];
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onEditEntry?: (entry: ConversationEntry) => void;
    onCompact?: () => void;
  };

  let {
    activeConversation,
    treeNodes = [],
    toolCalls = [],
    onNavigateToEntry,
    onEditEntry,
    onCompact,
  }: Props = $props();

  // biome-ignore lint/suspicious/noExplicitAny: lucide icon component interop
  type Icon = Component<any>;
  const ICONS: Record<HistoryIconName, Icon> = {
    user: User,
    sparkles: Sparkles,
    brain: Brain,
    wrench: Wrench,
    "file-text": FileText,
    terminal: Terminal,
    "file-pen": FilePen,
    "file-plus": FilePlus,
    search: Search,
    "folder-search": FolderSearch,
    "folder-tree": FolderTree,
    globe: Globe,
    download: Download,
    cpu: Cpu,
    bot: Bot,
    "message-circle-question": MessageCircleQuestion,
    "clipboard-list": ClipboardList,
    "clipboard-check": ClipboardCheck,
    "list-todo": ListTodo,
    "fold-vertical": FoldVertical,
    "git-branch": GitBranch,
    info: Info,
    hand: Hand,
    "triangle-alert": TriangleAlert,
  };

  const TONE_TEXT: Record<HistoryTone, string> = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    info: "text-info",
    danger: "text-destructive",
  };

  const ROW_H = 36;
  const LANE_W = 18;
  const PAD_X = 4;

  const toolCallsById = $derived(new Map(toolCalls.map((call) => [call.id, call])));
  const graph = $derived(buildHistoryGraph(treeNodes, activeConversation?.activeEntryId));
  const rows = $derived(graph.rows);
  const rowIndexById = $derived(new Map(rows.map((row, i) => [row.node.entry.id, i])));
  const gutterWidth = $derived(graph.laneCount * LANE_W + PAD_X * 2);

  function laneX(lane: number): number {
    return PAD_X + lane * LANE_W + LANE_W / 2;
  }
  function rowY(rowIndex: number): number {
    return rowIndex * ROW_H + ROW_H / 2;
  }

  type Edge = { d: string; active: boolean };
  const edges = $derived.by<Edge[]>(() => {
    const out: Edge[] = [];
    rows.forEach((row, i) => {
      const parentId = row.node.entry.parentEntryId;
      if (parentId === undefined || row.parentLane === undefined) return;
      const parentIndex = rowIndexById.get(parentId);
      if (parentIndex === undefined) return;
      const cx = laneX(row.lane);
      const cy = rowY(i);
      const px = laneX(row.parentLane);
      const py = rowY(parentIndex);
      const active = row.isOnActivePath;
      if (row.lane === row.parentLane) {
        out.push({ d: `M ${px} ${py} L ${cx} ${cy}`, active });
      } else {
        // Branch out just below the parent, then run straight down the new lane.
        const turn = py + ROW_H;
        out.push({
          d: `M ${px} ${py} C ${px} ${py + ROW_H * 0.6} ${cx} ${py + ROW_H * 0.4} ${cx} ${turn} L ${cx} ${cy}`,
          active,
        });
      }
    });
    return out;
  });

  let confirmCompactOpen = $state(false);

  function entryMenu(node: ConversationTreeNode): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: "Jump here", icon: ArrowRight, onSelect: () => onNavigateToEntry?.(node.entry.id) },
      { label: "Jump + summarize from here", icon: Sparkles, onSelect: () => onNavigateToEntry?.(node.entry.id, true) },
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
            await navigator.clipboard?.writeText(node.entry.id);
            toast.success("Copied entry id");
          } catch {
            toast.error("Could not copy to clipboard");
          }
        },
      },
    );
    return items;
  }
</script>

<div class="flex flex-col gap-1 p-2">
  <div class="flex items-center justify-end gap-1.5 pb-1">
    <Button size="sm" variant="outline" onclick={() => onNavigateToEntry?.(undefined)} disabled={!activeConversation}>
      Root
    </Button>
    <Button size="sm" variant="outline" onclick={() => (confirmCompactOpen = true)} disabled={!activeConversation}>
      Compact
    </Button>
  </div>

  {#if rows.length}
    <div class="relative" style={`min-height:${rows.length * ROW_H}px`}>
      <svg
        class="pointer-events-none absolute left-0 top-0"
        width={gutterWidth}
        height={rows.length * ROW_H}
        aria-hidden="true"
      >
        {#each edges as edge, i (i)}
          <path
            d={edge.d}
            fill="none"
            stroke={edge.active ? "var(--primary)" : "var(--border)"}
            stroke-width={edge.active ? 2 : 1.5}
          />
        {/each}
        {#each rows as row, i (row.node.entry.id)}
          {@const cx = laneX(row.lane)}
          {@const cy = rowY(i)}
          {@const color = row.isOnActivePath ? "var(--primary)" : "var(--muted-foreground)"}
          {#if row.isActive}
            <circle cx={cx} cy={cy} r={6.5} fill="none" stroke="var(--primary)" stroke-width={1.5} opacity={0.5} />
          {/if}
          <circle
            cx={cx}
            cy={cy}
            r={row.isLeaf ? 4.5 : 4}
            fill={row.isLeaf || row.isActive ? color : "var(--background)"}
            stroke={color}
            stroke-width={1.5}
          />
        {/each}
      </svg>

      <div class="flex flex-col">
        {#each rows as row, i (row.node.entry.id)}
          {@const desc = classifyHistoryEntry(row.node.entry, toolCallsById)}
          {@const Icon = ICONS[desc.icon]}
          <ContextMenu items={entryMenu(row.node)} triggerClass="block w-full min-w-0">
            <button
              class="relative flex w-full items-center gap-2 rounded-md pr-2 text-left transition-colors hover:bg-muted/60 data-[active=true]:bg-muted/70"
              class:opacity-55={!row.isOnActivePath}
              data-active={row.isActive}
              style={`height:${ROW_H}px; padding-left:${gutterWidth + PAD_X}px`}
              type="button"
              title="Jump here"
              onclick={() => onNavigateToEntry?.(row.node.entry.id)}
            >
              {#if row.isActive}
                <span class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true"></span>
              {/if}
              <span class={`flex size-5 shrink-0 items-center justify-center ${TONE_TEXT[desc.tone]}`}>
                <Icon class="size-4" strokeWidth={2} />
              </span>
              <span class="font-mono text-[10px] tabular-nums text-muted-foreground/50">
                {String(row.index).padStart(2, "0")}
              </span>
              <span class="shrink-0 text-xs font-medium text-foreground">{desc.label}</span>
              <span
                class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                class:font-mono={desc.mono}
              >
                {desc.preview}
              </span>
              {#each desc.badges as badge, b (b)}
                {@const BadgeIcon = ICONS[badge.icon]}
                <span class={`flex shrink-0 items-center gap-0.5 ${TONE_TEXT[badge.tone]}`} title={badge.title ?? badge.label}>
                  <BadgeIcon class="size-3" strokeWidth={2} />
                  {#if badge.label}<span class="text-[10px]">{badge.label}</span>{/if}
                </span>
              {/each}
              <span class="shrink-0 font-mono text-[10px] text-muted-foreground/50">
                {relativeTimeLabel(row.node.entry.createdAt)}
              </span>
            </button>
          </ContextMenu>
        {/each}
      </div>
    </div>
  {:else}
    <p class="px-1 py-6 text-center text-xs text-muted-foreground">No conversation history loaded.</p>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmCompactOpen}
  title="Compact conversation"
  description="This summarizes earlier messages to reduce context size. The full history stays available in the branch tree."
  confirmLabel="Compact"
  onConfirm={() => onCompact?.()}
/>
