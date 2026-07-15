import dagre from "@dagrejs/dagre";
import type { Edge, Node, Position } from "@xyflow/svelte";
import type { ConversationEntry } from "$lib/api";
import type { HistoryEntryView } from "./history-entry-view";
import type { HistoryGraphRow } from "./history-graph";
import type {
  HistorySegment,
  HistorySelection,
  HistoryVisible,
} from "./history-segments";

export const HISTORY_ROOT_NODE_ID = "history-root";

const TOP_POSITION = "top" as Position;
const BOTTOM_POSITION = "bottom" as Position;

/**
 * Fixed graph-space geometry. Keeping it here ensures Dagre and the Tailwind
 * card dimensions stay in lockstep while semantic zoom changes only content.
 */
export const HISTORY_NODE_GEOMETRY = {
  root: { width: 256, height: 80 },
  segment: { width: 288, height: 112 },
  entry: { width: 320, height: 192 },
  nodeGap: 48,
  rankGap: 64,
} as const;

export type HistoryZoomTier = "overview" | "summary" | "detail";

export type HistoryGraphNodeActions = {
  onToggleSegment: (segment: HistorySegment) => void;
  onNavigateToEntry?: (
    entryId: string | undefined,
    summarize?: boolean,
  ) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
};

type SharedNodeData = {
  zoomTier: HistoryZoomTier;
  actions?: HistoryGraphNodeActions;
  isOnActivePath: boolean;
  isActive: boolean;
};

export type HistoryRootNodeData = SharedNodeData & {
  kind: "root";
  selection: Extract<HistorySelection, { kind: "root" }>;
};

export type HistoryEntryNodeData = SharedNodeData & {
  kind: "entry";
  selection: Extract<HistorySelection, { kind: "entry" }>;
  row: HistoryGraphRow;
  view: HistoryEntryView;
};

export type HistorySegmentNodeData = SharedNodeData & {
  kind: "segment";
  selection: Extract<HistorySelection, { kind: "segment" }>;
  segment: HistorySegment;
};

export type HistoryFlowNodeData =
  | HistoryRootNodeData
  | HistoryEntryNodeData
  | HistorySegmentNodeData;

export type HistoryFlowNode = Node<HistoryFlowNodeData, "history">;
export type HistoryFlowEdge = Edge<{ isOnActivePath: boolean }, "smoothstep">;

export type HistoryFlow = {
  nodes: HistoryFlowNode[];
  edges: HistoryFlowEdge[];
  visibleNodeIdByEntryId: Map<string, string>;
};

type BuildHistoryFlowOptions = {
  visible: HistoryVisible;
  hasConversation: boolean;
  rootActive: boolean;
  rootOnActivePath: boolean;
  selectedKey: string;
  entryViewById: Map<string, HistoryEntryView>;
};

export function historyEntryNodeId(entryId: string): string {
  return `history-entry:${entryId}`;
}

export function historySegmentNodeId(segmentId: string): string {
  return `history-segment:${segmentId}`;
}

function selectionKey(selection: HistorySelection): string {
  if (selection.kind === "root") return "root";
  if (selection.kind === "entry") return `e:${selection.row.node.entry.id}`;
  return `s:${selection.segment.id}`;
}

function nodeDimensions(data: HistoryFlowNodeData) {
  return HISTORY_NODE_GEOMETRY[data.kind];
}

function ariaLabel(data: HistoryFlowNodeData): string {
  if (data.kind === "root") return "Start of conversation";
  if (data.kind === "segment") {
    return `${data.segment.total} collapsed conversation steps`;
  }
  const state = data.isActive ? ", active entry" : "";
  return `Step ${data.row.index}: ${data.view.descriptor.label}${state}`;
}

function makeNode(
  id: string,
  data: HistoryFlowNodeData,
  selectedKey: string,
): HistoryFlowNode {
  const dimensions = nodeDimensions(data);
  return {
    id,
    type: "history",
    position: { x: 0, y: 0 },
    initialWidth: dimensions.width,
    initialHeight: dimensions.height,
    data,
    selected: selectionKey(data.selection) === selectedKey,
    draggable: false,
    connectable: false,
    deletable: false,
    selectable: true,
    focusable: true,
    sourcePosition: BOTTOM_POSITION,
    targetPosition: TOP_POSITION,
    ariaLabel: ariaLabel(data),
    class: [
      data.isActive && "history-node-active",
      data.isOnActivePath && "history-node-on-path",
    ],
  };
}

function layoutFlow(
  nodes: HistoryFlowNode[],
  edges: HistoryFlowEdge[],
): HistoryFlowNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "TB",
    ranker: "tight-tree",
    nodesep: HISTORY_NODE_GEOMETRY.nodeGap,
    ranksep: HISTORY_NODE_GEOMETRY.rankGap,
    marginx: HISTORY_NODE_GEOMETRY.nodeGap,
    marginy: HISTORY_NODE_GEOMETRY.nodeGap,
  });

  for (const node of nodes) {
    const dimensions = nodeDimensions(node.data);
    graph.setNode(node.id, { ...dimensions });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id) as
      | { x: number; y: number }
      | undefined;
    const dimensions = nodeDimensions(node.data);
    return {
      ...node,
      position: position
        ? {
            x: position.x - dimensions.width / 2,
            y: position.y - dimensions.height / 2,
          }
        : node.position,
    };
  });
}

/** Convert visible history rows/segments into positioned Svelte Flow elements. */
export function buildHistoryFlow({
  visible,
  hasConversation,
  rootActive,
  rootOnActivePath,
  selectedKey,
  entryViewById,
}: BuildHistoryFlowOptions): HistoryFlow {
  if (!hasConversation) {
    return { nodes: [], edges: [], visibleNodeIdByEntryId: new Map() };
  }

  const visibleNodeIdByEntryId = new Map<string, string>();
  for (const item of visible.items) {
    if (item.type === "entry") {
      visibleNodeIdByEntryId.set(
        item.row.node.entry.id,
        historyEntryNodeId(item.row.node.entry.id),
      );
    } else {
      const nodeId = historySegmentNodeId(item.segment.id);
      for (const row of item.segment.rows) {
        visibleNodeIdByEntryId.set(row.node.entry.id, nodeId);
      }
    }
  }

  const rootData: HistoryRootNodeData = {
    kind: "root",
    selection: { kind: "root" },
    zoomTier: "summary",
    isActive: rootActive,
    isOnActivePath: rootOnActivePath,
  };
  const nodes: HistoryFlowNode[] = [
    makeNode(HISTORY_ROOT_NODE_ID, rootData, selectedKey),
  ];

  for (const item of visible.items) {
    if (item.type === "entry") {
      const entryId = item.row.node.entry.id;
      const view = entryViewById.get(entryId);
      if (!view) continue;
      const selection: HistorySelection = { kind: "entry", row: item.row };
      nodes.push(
        makeNode(
          historyEntryNodeId(entryId),
          {
            kind: "entry",
            selection,
            row: item.row,
            view,
            zoomTier: "summary",
            isActive: item.row.isActive,
            isOnActivePath: item.row.isOnActivePath,
          },
          selectedKey,
        ),
      );
    } else {
      const selection: HistorySelection = {
        kind: "segment",
        segment: item.segment,
      };
      nodes.push(
        makeNode(
          historySegmentNodeId(item.segment.id),
          {
            kind: "segment",
            selection,
            segment: item.segment,
            zoomTier: "summary",
            isActive: false,
            isOnActivePath: item.segment.isOnActivePath,
          },
          selectedKey,
        ),
      );
    }
  }

  const edges: HistoryFlowEdge[] = [];
  for (const node of nodes) {
    if (node.id === HISTORY_ROOT_NODE_ID) continue;
    const parentEntryId =
      node.data.kind === "entry"
        ? node.data.row.node.entry.parentEntryId
        : node.data.kind === "segment"
          ? node.data.segment.headParentEntryId
          : undefined;
    const source = parentEntryId
      ? (visibleNodeIdByEntryId.get(parentEntryId) ?? HISTORY_ROOT_NODE_ID)
      : HISTORY_ROOT_NODE_ID;
    if (source === node.id) continue;
    const active = node.data.isOnActivePath;
    edges.push({
      id: `history-edge:${source}->${node.id}`,
      source,
      target: node.id,
      type: "smoothstep",
      data: { isOnActivePath: active },
      class: active ? "history-edge-active" : undefined,
      selectable: false,
      deletable: false,
      focusable: false,
      ariaLabel: active
        ? "Conversation branch connection on active path"
        : "Conversation branch connection",
    });
  }

  return {
    nodes: layoutFlow(nodes, edges),
    edges,
    visibleNodeIdByEntryId,
  };
}

export function presentHistoryFlow(
  flow: HistoryFlow,
  zoomTier: HistoryZoomTier,
  actions: HistoryGraphNodeActions,
): HistoryFlow {
  return {
    ...flow,
    nodes: flow.nodes.map((node) => ({
      ...node,
      data: { ...node.data, zoomTier, actions },
    })),
  };
}

export function historyZoomTier(zoom: number): HistoryZoomTier {
  if (zoom < 0.4) return "overview";
  if (zoom < 0.85) return "summary";
  return "detail";
}
