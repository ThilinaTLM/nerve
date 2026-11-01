<script lang="ts">
import { SvelteFlow, type Edge, type Node } from "@xyflow/svelte";
import HistoryBranchEdge from "./HistoryBranchEdge.svelte";
import HistoryCamera from "./HistoryCamera.svelte";
import HistoryPoint from "./HistoryPoint.svelte";
import {
  buildHistoryFlow,
  historyLayout,
  type HistoryTree,
} from "./history-tree";

type Props = {
  tree: HistoryTree;
  selectedId: string;
  /** Nodes that match the current search. */
  matchIds: ReadonlySet<string>;
  /** Bump to centre the camera on the selected node. */
  centerRequest: number;
  /** Bump to fit the whole tree. */
  fitRequest: number;
  onSelect: (id: string) => void;
  onKeyNavigate: (event: KeyboardEvent) => void;
  /** The canvas is measured and ready to be centred. */
  onReady: () => void;
};

let {
  tree,
  selectedId,
  matchIds,
  centerRequest,
  fitRequest,
  onSelect,
  onKeyNavigate,
  onReady,
}: Props = $props();

const nodeTypes = { point: HistoryPoint };
const edgeTypes = { branch: HistoryBranchEdge };

// Layout runs once per tree; selection and search only restyle nodes.
const flow = $derived(buildHistoryFlow(tree, historyLayout(tree)));
const positionById = $derived(
  new Map(flow.nodes.map((node) => [node.id, node.position])),
);
const nodes = $derived(
  flow.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      selected: node.id === selectedId,
      match: matchIds.has(node.id),
    },
  })) as Node[],
);
const edges = $derived(flow.edges as Edge[]);
const focus = $derived.by(() => {
  const at = positionById.get(selectedId);
  return at ? { x: at.x + 6, y: at.y + 6 } : undefined;
});
</script>

<!-- Pan and zoom with the pointer; arrow keys walk the tree. Svelte Flow only
     renders the nodes in view, so very long conversations stay light. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<div
  class="h-full min-h-0 outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
  role="application"
  tabindex="0"
  aria-label="Conversation tree. Arrow keys move along branches."
  onkeydown={onKeyNavigate}
>
  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    {edgeTypes}
    minZoom={0.1}
    maxZoom={1.6}
    onlyRenderVisibleElements
    nodesDraggable={false}
    nodesConnectable={false}
    nodesFocusable={false}
    edgesFocusable={false}
    elementsSelectable={false}
    zoomOnDoubleClick={false}
    deleteKey={null}
    proOptions={{ hideAttribution: true }}
    onnodeclick={({ node }) => onSelect(node.id)}
    oninit={() => requestAnimationFrame(onReady)}
  >
    <HistoryCamera {focus} request={centerRequest} fit={fitRequest} />
  </SvelteFlow>
</div>
