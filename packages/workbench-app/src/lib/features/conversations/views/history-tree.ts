import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type {
  ConversationTreeNode,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";
import {
  classifyHistoryEntry,
  parseToolCallNames,
  toolIcon,
  type HistoryIconName,
  type HistoryNodeDescriptor,
} from "./history-graph";
import {
  HISTORY_NODE_SIZE,
  layoutHistoryTree,
  type HistoryLayout,
} from "./history-layout";

/**
 * Message-level model of the conversation tree.
 *
 * Every user message and every substantive assistant reply is one node. Tool
 * calls, tool results and system notices that sit in a straight line before a
 * reply fold into that reply, which carries their summary. Entries that anchor
 * the tree's shape (forks, leaves, the active entry, summaries, human-in-the-
 * loop turns) are never folded.
 *
 * Pure and free of component imports so it stays unit-testable under node:test.
 */

export const HISTORY_ROOT_ID = "history-root";

type EntryOf = ConversationTreeNode["entry"];

export type HistoryNodeKind = "start" | "user" | "assistant";
export type HistoryNodeRole = "start" | "fork" | "tip" | "entry";

export type HistoryStepSummary = {
  key: string;
  icon: HistoryIconName;
  label: string;
  tone: StatusTone;
  count: number;
  /** True for tool calls; other folded steps are notices. */
  tool: boolean;
};

export type HistoryTreeNode = {
  /** Owner entry id, or {@link HISTORY_ROOT_ID} for the start of the tree. */
  id: string;
  kind: HistoryNodeKind;
  role: HistoryNodeRole;
  entry?: EntryOf;
  parentId?: string;
  /** Side branches first; the last child continues the branch. */
  childIds: string[];
  label: string;
  descriptor?: HistoryNodeDescriptor;
  /** Entries folded into this node, oldest first. */
  folded: EntryOf[];
  steps: HistoryStepSummary[];
  toolCount: number;
  /** On the path from the start to the active entry. */
  current: boolean;
  head: boolean;
};

export type HistoryTree = {
  nodes: Map<string, HistoryTreeNode>;
  /** Node ids in tree order (parents before children). */
  order: string[];
  headId: string;
  /** Node that represents each stored entry (folded entries map to their reply). */
  ownerOf: Map<string, string>;
  entryCount: number;
  branchCount: number;
};

const FOLDABLE_TYPES = new Set(["tool_call", "tool_result", "system"]);

function summarizeSteps(
  folded: EntryOf[],
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
): { steps: HistoryStepSummary[]; toolCount: number } {
  type Tally = HistoryStepSummary & { results: number };
  const tallies = new Map<string, Tally>();
  const tally = (
    key: string,
    icon: HistoryIconName,
    tone: StatusTone,
    tool: boolean,
  ): Tally => {
    let found = tallies.get(key);
    if (!found) {
      found = { key, icon, label: key, tone, count: 0, tool, results: 0 };
      tallies.set(key, found);
    }
    return found;
  };
  for (const entry of folded) {
    const descriptor = classifyHistoryEntry(entry, toolCallsById);
    if (descriptor.type === "tool_call") {
      for (const name of parseToolCallNames(entry.text)) {
        tally(name, toolIcon(name), "neutral", true).count += 1;
      }
    } else if (descriptor.type === "tool_result") {
      const found = tally(descriptor.label, descriptor.icon, "neutral", true);
      found.results += 1;
      if (descriptor.tone === "destructive") found.tone = "destructive";
    } else {
      tally(descriptor.label, descriptor.icon, "neutral", false).count += 1;
    }
  }
  const steps = [...tallies.values()].map(({ results, ...step }) => ({
    ...step,
    count: step.tool ? Math.max(step.count, results) : step.count,
  }));
  steps.sort((a, b) => Number(b.tool) - Number(a.tool) || b.count - a.count);
  return {
    steps,
    toolCount: steps.reduce((sum, s) => sum + (s.tool ? s.count : 0), 0),
  };
}

/**
 * Build the message-level tree for a conversation. `activeEntryId` is the
 * current head; without it (or when unknown) the start of the conversation is
 * the head.
 */
export function buildHistoryTree(
  treeNodes: ConversationTreeNode[],
  activeEntryId: string | undefined,
  toolCallsById: Map<string, ToolCallTranscriptRecord> = new Map(),
): HistoryTree {
  const byId = new Map(treeNodes.map((node) => [node.entry.id, node]));
  const childrenOfEntry = (id: string): string[] =>
    (byId.get(id)?.childEntryIds ?? []).filter((child) => byId.has(child));
  const roots = treeNodes
    .filter(
      (node) =>
        node.entry.parentEntryId === undefined ||
        !byId.has(node.entry.parentEntryId),
    )
    .map((node) => node.entry.id);

  const activeKnown = activeEntryId !== undefined && byId.has(activeEntryId);
  const activePath = new Set<string>();
  for (
    let cursor = activeKnown ? activeEntryId : undefined;
    cursor && !activePath.has(cursor);
    cursor = byId.get(cursor)?.entry.parentEntryId
  ) {
    activePath.add(cursor);
  }

  const descriptors = new Map<string, HistoryNodeDescriptor>();
  const describe = (entry: EntryOf): HistoryNodeDescriptor => {
    let found = descriptors.get(entry.id);
    if (!found) {
      found = classifyHistoryEntry(entry, toolCallsById);
      descriptors.set(entry.id, found);
    }
    return found;
  };
  const foldable = (id: string): boolean => {
    const node = byId.get(id)!;
    return (
      id !== activeEntryId &&
      childrenOfEntry(id).length === 1 &&
      FOLDABLE_TYPES.has(describe(node.entry).type)
    );
  };

  const nodes = new Map<string, HistoryTreeNode>();
  const order: string[] = [];
  const ownerOf = new Map<string, string>();
  const root: HistoryTreeNode = {
    id: HISTORY_ROOT_ID,
    kind: "start",
    role: "start",
    childIds: [],
    label: "Start of conversation",
    folded: [],
    steps: [],
    toolCount: 0,
    current: true,
    head: !activeKnown,
  };
  nodes.set(root.id, root);
  order.push(root.id);

  const visited = new Set<string>();
  const stack: { entryId: string; parentId: string }[] = [...roots]
    .reverse()
    .map((entryId) => ({ entryId, parentId: root.id }));
  while (stack.length) {
    const { entryId, parentId } = stack.pop()!;
    if (visited.has(entryId)) continue;
    const folded: EntryOf[] = [];
    let ownerEntryId = entryId;
    visited.add(ownerEntryId);
    while (foldable(ownerEntryId)) {
      folded.push(byId.get(ownerEntryId)!.entry);
      const next = childrenOfEntry(ownerEntryId)[0]!;
      if (visited.has(next)) break;
      ownerEntryId = next;
      visited.add(ownerEntryId);
    }
    const entry = byId.get(ownerEntryId)!.entry;
    const descriptor = describe(entry);
    const { steps, toolCount } = summarizeSteps(folded, toolCallsById);
    const node: HistoryTreeNode = {
      id: ownerEntryId,
      kind: entry.role === "user" ? "user" : "assistant",
      role: "entry",
      entry,
      parentId,
      childIds: [],
      label: descriptor.preview,
      descriptor,
      folded,
      steps,
      toolCount,
      current: activePath.has(ownerEntryId),
      head: ownerEntryId === activeEntryId,
    };
    nodes.set(node.id, node);
    order.push(node.id);
    ownerOf.set(ownerEntryId, node.id);
    for (const part of folded) ownerOf.set(part.id, node.id);
    nodes.get(parentId)!.childIds.push(node.id);

    const children = childrenOfEntry(ownerEntryId);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ entryId: children[i]!, parentId: node.id });
    }
  }

  // A branch that ends in steps rather than a reply (tool calls still running,
  // a trailing system notice) folds those steps back into the last message,
  // so a tip is always a readable message.
  for (const id of [...order].reverse()) {
    let node = nodes.get(id);
    while (
      node?.entry &&
      node.childIds.length === 0 &&
      FOLDABLE_TYPES.has(node.descriptor?.type ?? "")
    ) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (!parent?.entry || parent.childIds.length !== 1) break;
      parent.folded.push(...node.folded, node.entry);
      Object.assign(parent, summarizeSteps(parent.folded, toolCallsById));
      parent.head ||= node.head;
      parent.childIds = [];
      for (const [entryId, owner] of ownerOf)
        if (owner === node.id) ownerOf.set(entryId, parent.id);
      nodes.delete(node.id);
      order.splice(order.indexOf(node.id), 1);
      node = parent;
    }
  }

  let branchCount = 0;
  for (const node of nodes.values()) {
    // The branch that continues the current path is last, like the layout wants.
    node.childIds.sort(
      (a, b) => Number(nodes.get(a)!.current) - Number(nodes.get(b)!.current),
    );
    if (node.childIds.length > 1) node.role = "fork";
    else if (node.childIds.length === 0) {
      if (node.id !== HISTORY_ROOT_ID) node.role = "tip";
      branchCount += 1;
    }
  }

  const headId = activeKnown
    ? (ownerOf.get(activeEntryId) ?? HISTORY_ROOT_ID)
    : HISTORY_ROOT_ID;
  return {
    nodes,
    order,
    headId,
    ownerOf,
    entryCount: treeNodes.length,
    branchCount,
  };
}

/** Distinct nodes whose entries (or folded steps) mention the query, oldest first. */
export function findHistoryMatches(tree: HistoryTree, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hit = (entry: EntryOf) =>
    (entry.summary || entry.text).toLowerCase().includes(needle);
  const matches: { id: string; at: string }[] = [];
  for (const id of tree.order) {
    const node = tree.nodes.get(id)!;
    const entries = node.entry ? [...node.folded, node.entry] : [];
    const first = entries.find(hit);
    if (first) matches.push({ id, at: first.createdAt });
  }
  return matches
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((match) => match.id);
}

/** Arrow-key walking: parent, continuing child, sibling branches at a fork. */
export function historyKeyTarget(
  tree: HistoryTree,
  fromId: string,
  key: string,
): string | undefined {
  const node = tree.nodes.get(fromId);
  if (!node) return undefined;
  const siblings = node.parentId
    ? (tree.nodes.get(node.parentId)?.childIds ?? [])
    : [];
  const at = siblings.indexOf(fromId);
  switch (key) {
    case "ArrowUp":
      return node.parentId;
    case "ArrowDown":
      return node.childIds.at(-1);
    case "ArrowLeft":
      return at > 0 ? siblings[at - 1] : undefined;
    case "ArrowRight":
      return at >= 0 ? siblings[at + 1] : undefined;
    case "Home":
      return HISTORY_ROOT_ID;
    case "End":
    case "c":
    case "C":
      return tree.headId;
    default:
      return undefined;
  }
}

export type HistoryPointData = {
  nodeId: string;
  kind: HistoryNodeKind;
  head: boolean;
  current: boolean;
  label: string;
  toolCount: number;
  labelWidth: number;
  selected: boolean;
  match: boolean;
  [key: string]: unknown;
};

export type HistoryFlowNode = {
  id: string;
  type: "point";
  position: { x: number; y: number };
  width: number;
  height: number;
  data: HistoryPointData;
};

export type HistoryFlowEdge = {
  id: string;
  source: string;
  target: string;
  type: "branch";
  style: string;
};

const EDGE_CURRENT = "stroke: var(--primary); stroke-width: 1.5";
const EDGE_OTHER =
  "stroke: var(--muted-foreground); stroke-opacity: 0.5; stroke-width: 1.25";

export function historyLayout(tree: HistoryTree): HistoryLayout {
  const childrenOf = new Map<string, string[]>();
  for (const id of tree.order) childrenOf.set(id, tree.nodes.get(id)!.childIds);
  return layoutHistoryTree({ root: HISTORY_ROOT_ID, childrenOf });
}

/** Svelte Flow nodes and edges. `selected` and `match` are layered on by the view. */
export function buildHistoryFlow(
  tree: HistoryTree,
  layout: HistoryLayout,
): { nodes: HistoryFlowNode[]; edges: HistoryFlowEdge[] } {
  const nodes: HistoryFlowNode[] = [];
  const edges: HistoryFlowEdge[] = [];
  for (const id of tree.order) {
    const node = tree.nodes.get(id)!;
    const placed = layout.nodes.get(id);
    if (!placed) continue;
    nodes.push({
      id,
      type: "point",
      position: {
        x: placed.x - HISTORY_NODE_SIZE / 2,
        y: placed.y - HISTORY_NODE_SIZE / 2,
      },
      width: HISTORY_NODE_SIZE,
      height: HISTORY_NODE_SIZE,
      data: {
        nodeId: id,
        kind: node.kind,
        head: node.head,
        current: node.current,
        label: node.label,
        toolCount: node.toolCount,
        labelWidth: placed.labelWidth,
        selected: false,
        match: false,
      },
    });
    for (const child of node.childIds) {
      edges.push({
        id: `${id}->${child}`,
        source: id,
        target: child,
        type: "branch",
        style: tree.nodes.get(child)!.current ? EDGE_CURRENT : EDGE_OTHER,
      });
    }
  }
  return { nodes, edges };
}
