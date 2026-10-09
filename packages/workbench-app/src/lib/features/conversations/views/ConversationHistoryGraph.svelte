<script lang="ts">
import { SvelteMap } from "svelte/reactivity";
import { Background, MiniMap, SvelteFlow, type Edge } from "@xyflow/svelte";
import type { EventTreeNode } from "@nervekit/contracts/core";
import HistoryGraphNode from "./HistoryGraphNode.svelte";
import type { HistoryNode } from "./history-graph";
import { Button } from "@nervekit/ui-kit/components/ui/button";
let {
  treeNodes = [],
  headEventId,
  disabled = false,
  onSelect,
}: {
  treeNodes?: EventTreeNode[];
  headEventId?: string | null;
  disabled?: boolean;
  onSelect?: (id: string | null) => void;
} = $props();
let selected = $derived<string | null>(headEventId ?? null);
const graph = $derived.by(() => {
  const depth = new SvelteMap<string, number>();
  const lanes = new SvelteMap<number, number>();
  const nodes: HistoryNode[] = [
    {
      id: "root",
      type: "history",
      position: { x: 0, y: 0 },
      width: 240,
      height: 160,
      data: { active: headEventId === null, onSelect, disabled },
    },
  ];
  const edges: Edge[] = [];
  for (const event of treeNodes) {
    const level =
      (event.previousEventId ? (depth.get(event.previousEventId) ?? 0) : 0) + 1;
    depth.set(event.id, level);
    const lane = lanes.get(level) ?? 0;
    lanes.set(level, lane + 1);
    nodes.push({
      id: event.id,
      type: "history",
      width: 240,
      height: 160,
      position: { x: lane * 280, y: level * 200 },
      data: { event, active: event.id === headEventId, onSelect, disabled },
      selected: event.id === headEventId,
    });
    edges.push({
      id: `edge:${event.id}`,
      source: event.previousEventId ?? "root",
      target: event.id,
    });
  }
  return { nodes, edges };
});
</script>
<div class="flex h-full min-h-0 flex-col">
  <div class="min-h-0 flex-1">
    <SvelteFlow
      nodeTypes={{ history: HistoryGraphNode }}
      nodes={graph.nodes}
      edges={graph.edges}
      fitView
      nodesDraggable={false}
      onnodeclick={({ node }) =>
        (selected = node.id === "root" ? null : node.id)}
      ><Background /><MiniMap /></SvelteFlow
    >
  </div>
  <div class="flex justify-end border-t p-2">
    <Button size="sm" {disabled} onclick={() => onSelect?.(selected)}
      >Continue from selected event</Button
    >
  </div>
</div>
