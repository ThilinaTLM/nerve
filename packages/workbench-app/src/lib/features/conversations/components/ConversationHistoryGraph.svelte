<script lang="ts">
import X from "@lucide/svelte/icons/x";
import { SvelteSet } from "svelte/reactivity";
import {
  Background,
  MiniMap,
  SvelteFlow,
  type Node,
  type Viewport,
} from "@xyflow/svelte";
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { buildHistoryEntryView } from "./history-entry-view";
import {
  buildHistoryFlow,
  HISTORY_ROOT_NODE_ID,
  historyEntryNodeId,
  historyZoomTier,
  presentHistoryFlow,
  type HistoryFlowNode,
  type HistoryZoomTier,
} from "./history-flow";
import { buildHistoryGraph } from "./history-graph";
import HistoryDetailPane from "./HistoryDetailPane.svelte";
import HistoryGraphControls from "./HistoryGraphControls.svelte";
import HistoryGraphNode from "./HistoryGraphNode.svelte";
import {
  buildHistoryVisible,
  selectionKey,
  type HistorySegment,
  type HistorySelection,
} from "./history-segments";

type Props = {
  activeConversation?: ConversationRecord;
  treeNodes?: ConversationTreeNode[];
  toolCalls?: ToolCallTranscriptRecord[];
  onNavigateToEntry?: (
    entryId: string | undefined,
    summarize?: boolean,
  ) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
};

let {
  activeConversation,
  treeNodes = [],
  toolCalls = [],
  onNavigateToEntry,
  onEditEntry,
}: Props = $props();

const nodeTypes = { history: HistoryGraphNode };
const toolCallsById = $derived(
  new Map(toolCalls.map((call) => [call.id, call])),
);
const graph = $derived(
  buildHistoryGraph(treeNodes, activeConversation?.activeEntryId),
);
const hasConversation = $derived(Boolean(activeConversation));
const rootActive = $derived(
  Boolean(activeConversation && !activeConversation.activeEntryId),
);
const rootOnActivePath = $derived(
  rootActive || graph.rows.some((row) => row.isOnActivePath),
);
const entryViewById = $derived(
  new Map(
    treeNodes.map(({ entry }) => [
      entry.id,
      buildHistoryEntryView(entry, toolCallsById),
    ]),
  ),
);

let expanded = $state<Set<string>>(new Set());
let selection = $state<HistorySelection | undefined>(undefined);
let inspectorOpen = $state(false);
let zoomTier = $state<HistoryZoomTier>("summary");
let fitRequest = $state(0);
let centerSerial = $state(0);
let centerRequest = $state<{ id: string; serial: number } | undefined>();
let selectionEventsReady = $state(false);

const visible = $derived(
  buildHistoryVisible(graph.rows, toolCallsById, expanded),
);
const currentSelectionKey = $derived(selection ? selectionKey(selection) : "");
const allExpanded = $derived(
  visible.segments.length > 0 &&
    visible.segments.every((segment) => expanded.has(segment.id)),
);
const baseFlow = $derived(
  buildHistoryFlow({
    visible,
    hasConversation,
    rootActive,
    rootOnActivePath,
    selectedKey: currentSelectionKey,
    entryViewById,
  }),
);
const actions = $derived({
  onToggleSegment: toggleSegment,
  onNavigateToEntry,
  onEditEntry,
});
const flow = $derived(presentHistoryFlow(baseFlow, zoomTier, actions));
const activeNodeId = $derived(
  activeConversation?.activeEntryId
    ? (baseFlow.visibleNodeIdByEntryId.get(activeConversation.activeEntryId) ??
        historyEntryNodeId(activeConversation.activeEntryId))
    : HISTORY_ROOT_NODE_ID,
);

let lastConversationId: string | undefined;
$effect(() => {
  const conversationId = activeConversation?.id;
  if (conversationId === lastConversationId) return;
  lastConversationId = conversationId;
  expanded = new Set();
  inspectorOpen = false;
  if (!conversationId) selectionEventsReady = false;

  const activeEntryId = activeConversation?.activeEntryId;
  const activeRow = activeEntryId
    ? graph.rows.find((row) => row.node.entry.id === activeEntryId)
    : undefined;
  selection = activeConversation
    ? activeRow
      ? { kind: "entry", row: activeRow }
      : { kind: "root" }
    : undefined;
  fitRequest += 1;
});

function requestCenter(id: string) {
  centerRequest = { id, serial: ++centerSerial };
}

function selectHistory(next: HistorySelection) {
  selection = next;
  inspectorOpen = true;
}

function segmentContainingEntry(entryId: string): HistorySegment | undefined {
  return visible.segments.find((segment) =>
    segment.rows.some((row) => row.node.entry.id === entryId),
  );
}

function toggleSegment(segment: HistorySegment) {
  const next = new SvelteSet(expanded);
  if (next.has(segment.id)) {
    next.delete(segment.id);
    const selectedEntryId =
      selection?.kind === "entry" ? selection.row.node.entry.id : undefined;
    if (
      selectedEntryId &&
      segment.rows.some((row) => row.node.entry.id === selectedEntryId)
    ) {
      selection = { kind: "segment", segment };
    }
    expanded = next;
    requestCenter(`history-segment:${segment.id}`);
    return;
  }

  next.add(segment.id);
  expanded = next;
  const head = segment.rows[0];
  if (head) selection = { kind: "entry", row: head };
  requestCenter(head ? historyEntryNodeId(head.node.entry.id) : activeNodeId);
}

function toggleAll() {
  if (allExpanded) {
    const selectedSegment =
      selection?.kind === "entry"
        ? segmentContainingEntry(selection.row.node.entry.id)
        : undefined;
    expanded = new Set();
    if (selectedSegment) {
      selection = { kind: "segment", segment: selectedSegment };
      requestCenter(`history-segment:${selectedSegment.id}`);
    }
    return;
  }

  expanded = new Set(visible.segments.map((segment) => segment.id));
  if (selection?.kind === "segment") {
    const head = selection.segment.rows[0];
    if (head) {
      selection = { kind: "entry", row: head };
      requestCenter(historyEntryNodeId(head.node.entry.id));
    }
  }
}

function expandSegment(id: string) {
  const segment = visible.segments.find((candidate) => candidate.id === id);
  if (segment && !expanded.has(id)) toggleSegment(segment);
}

function selectRow(row: Extract<HistorySelection, { kind: "entry" }>["row"]) {
  const segment = segmentContainingEntry(row.node.entry.id);
  if (segment && !expanded.has(segment.id)) {
    const next = new SvelteSet(expanded);
    next.add(segment.id);
    expanded = next;
  }
  selection = { kind: "entry", row };
  requestCenter(historyEntryNodeId(row.node.entry.id));
}

function handleMove(_event: unknown, viewport: Viewport) {
  const next = historyZoomTier(viewport.zoom);
  if (next !== zoomTier) zoomTier = next;
}

function handleNodeClick(node: HistoryFlowNode) {
  selectHistory(node.data.selection);
}

function handleSelectionChange(nodes: HistoryFlowNode[]) {
  if (!selectionEventsReady || nodes.length !== 1) return;
  selectHistory(nodes[0].data.selection);
}

function minimapNodeColor(node: Node): string {
  return node.data.isActive || node.data.isOnActivePath
    ? "var(--primary)"
    : "var(--muted-foreground)";
}
</script>

<div
  class="history-graph relative h-full min-h-0 overflow-hidden bg-background"
>
  {#if hasConversation}
    <SvelteFlow
      nodes={flow.nodes}
      edges={flow.edges}
      {nodeTypes}
      minZoom={0.12}
      maxZoom={1.75}
      onlyRenderVisibleElements
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      nodesFocusable
      edgesFocusable={false}
      selectionOnDrag={false}
      selectNodesOnDrag={false}
      deleteKey={null}
      multiSelectionKey={null}
      zoomOnDoubleClick={false}
      onmove={handleMove}
      onnodeclick={({ node }) => handleNodeClick(node)}
      onselectionchange={({ nodes }) => handleSelectionChange(nodes)}
      onpaneclick={() => (inspectorOpen = false)}
      oninit={() =>
        queueMicrotask(() => {
          selectionEventsReady = true;
        })}
    >
      <Background gap={24} size={1} />
      <MiniMap
        position="bottom-left"
        pannable
        zoomable
        nodeColor={minimapNodeColor}
        nodeStrokeColor={minimapNodeColor}
        nodeStrokeWidth={2}
        nodeBorderRadius={6}
        ariaLabel="Conversation graph minimap"
      />
      <HistoryGraphControls
        {activeNodeId}
        hasSegments={visible.segments.length > 0}
        {allExpanded}
        onToggleAll={toggleAll}
        {fitRequest}
        {centerRequest}
      />
    </SvelteFlow>

    {#if inspectorOpen && selection}
      <aside
        class="absolute inset-y-3 right-3 z-10 flex w-96 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
        aria-label="Conversation entry details"
      >
        <div class="flex items-center justify-between border-b px-3 py-2">
          <span class="text-xs font-medium text-muted-foreground">Details</span>
          <Button
            variant="ghost"
            size="icon-xs"
            ariaLabel="Close details"
            title="Close details"
            onclick={() => (inspectorOpen = false)}
          >
            <X class="size-3.5" strokeWidth={2} />
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <HistoryDetailPane
            {selection}
            {toolCallsById}
            {onNavigateToEntry}
            {onEditEntry}
            onSelectRow={selectRow}
            onExpandSegment={expandSegment}
          />
        </div>
      </aside>
    {/if}
  {:else}
    <div
      class="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
    >
      No conversation history loaded.
    </div>
  {/if}
</div>
