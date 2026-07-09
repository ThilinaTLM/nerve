<script lang="ts">
  import FoldVertical from "@lucide/svelte/icons/fold-vertical";
  import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
  import type {
    ConversationEntry,
    ConversationRecord,
    ConversationTreeNode,
    ToolCallTranscriptRecord,
  } from "$lib/api";
  import { buttonVariants } from "@nervekit/shared-ui/components/ui/button";
  import { buildHistoryGraph } from "./history-graph";
  import HistoryBranchRail from "./HistoryBranchRail.svelte";
  import HistoryDetailPane from "./HistoryDetailPane.svelte";
  import {
    buildHistoryVisible,
    selectionKey,
    type HistorySelection,
  } from "./history-segments";

  type Props = {
    activeConversation?: ConversationRecord;
    treeNodes?: ConversationTreeNode[];
    toolCalls?: ToolCallTranscriptRecord[];
    onNavigateToEntry?: (entryId: string | undefined, summarize?: boolean) => void;
    onEditEntry?: (entry: ConversationEntry) => void;
  };

  let {
    activeConversation,
    treeNodes = [],
    toolCalls = [],
    onNavigateToEntry,
    onEditEntry,
  }: Props = $props();

  const toolCallsById = $derived(new Map(toolCalls.map((call) => [call.id, call])));
  const graph = $derived(buildHistoryGraph(treeNodes, activeConversation?.activeEntryId));
  const treeNodeIds = $derived(new Set(treeNodes.map((node) => node.entry.id)));
  const hasConversation = $derived(Boolean(activeConversation));
  const rootActive = $derived(Boolean(activeConversation && !activeConversation.activeEntryId));
  const rootOnActivePath = $derived(rootActive || graph.rows.some((row) => row.isOnActivePath));

  let expanded = $state(new Set<string>());
  let selection = $state<HistorySelection | undefined>(undefined);

  const visible = $derived(buildHistoryVisible(graph.rows, toolCallsById, expanded));
  const selectedKey = $derived(selection ? selectionKey(selection) : "");

  // (Re)initialise expansion + selection whenever the open conversation changes.
  let lastConvId: string | undefined;
  $effect(() => {
    const convId = activeConversation?.id;
    if (convId === lastConvId) return;
    lastConvId = convId;
    // Start fully collapsed so the branch shape is scannable at a glance; the
    // user expands runs (or Expand all) when they want the detail.
    expanded = new Set();
    const id = activeConversation?.activeEntryId;
    const activeRow = id ? graph.rows.find((row) => row.node.entry.id === id) : undefined;
    selection = activeRow ? { kind: "entry", row: activeRow } : { kind: "root" };
  });

  const allExpanded = $derived(
    visible.segments.length > 0 && visible.segments.every((segment) => expanded.has(segment.id)),
  );

  function toggleSegment(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function toggleAll() {
    expanded = allExpanded ? new Set() : new Set(visible.segments.map((segment) => segment.id));
  }

  function expandSegment(id: string) {
    const next = new Set(expanded);
    next.add(id);
    expanded = next;
    const head = graph.rows.find((row) => row.node.entry.id === id);
    if (head) selection = { kind: "entry", row: head };
  }
</script>

<div class="flex h-full min-h-0">
  <div class="flex w-80 shrink-0 flex-col border-r">
    <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
      <h2 class="text-xs font-medium text-muted-foreground">Branches</h2>
      {#if visible.segments.length > 0}
        <button
          class={buttonVariants({ variant: "ghost", size: "sm" })}
          type="button"
          onclick={toggleAll}
        >
          {#if allExpanded}
            <FoldVertical class="size-3.5" strokeWidth={2} />
            Collapse all
          {:else}
            <UnfoldVertical class="size-3.5" strokeWidth={2} />
            Expand all
          {/if}
        </button>
      {/if}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <HistoryBranchRail
        items={visible.items}
        visibleIndexById={visible.visibleIndexById}
        {treeNodeIds}
        {toolCallsById}
        laneCount={graph.laneCount}
        {hasConversation}
        {rootActive}
        {rootOnActivePath}
        {expanded}
        {selectedKey}
        onSelect={(next) => (selection = next)}
        onToggleSegment={toggleSegment}
        {onNavigateToEntry}
        {onEditEntry}
      />
    </div>
  </div>

  <div class="min-w-0 flex-1 overflow-y-auto bg-card">
    <HistoryDetailPane
      {selection}
      {toolCallsById}
      {onNavigateToEntry}
      {onEditEntry}
      onSelectRow={(row) => (selection = { kind: "entry", row })}
      onExpandSegment={expandSegment}
    />
  </div>
</div>
