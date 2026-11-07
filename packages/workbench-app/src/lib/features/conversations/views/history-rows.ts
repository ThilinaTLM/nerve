import {
  HISTORY_ROOT_ID,
  type HistoryStepSummary,
  type HistoryTree,
  type HistoryTreeNode,
} from "./history-tree";

/**
 * List model for the History view: items (turns or single messages) laid out
 * top to bottom with git-log style lanes. The current path always stays in
 * lane 0; side branches are drawn next to it, between their fork point and
 * the next item on the parent branch.
 *
 * Pure and free of component imports so it stays unit-testable under node:test.
 */

export type HistoryMode = "messages" | "steps";

export type HistoryItem = {
  /** Anchor node id: the user message that opens a turn, or the node itself. */
  id: string;
  node: HistoryTreeNode;
  /** Node the conversation rewinds to: the end of the item on its own path. */
  targetId: string;
  /** Nodes summarized by this item, anchor first, along its continuing path. */
  members: HistoryTreeNode[];
  /** Last assistant reply in the item, when there is one. */
  reply?: HistoryTreeNode;
  toolCount: number;
  steps: HistoryStepSummary[];
  parentId?: string;
  /** Side branches first; the last child continues the branch. */
  childIds: string[];
  /** On the path from the start to the current head. */
  current: boolean;
  /** Contains the current head. */
  head: boolean;
  startedAt?: string;
  endedAt?: string;
};

export type HistoryItems = {
  items: Map<string, HistoryItem>;
  /** Parents before children. */
  order: string[];
  rootId: string;
  headId: string;
};

function mergeSteps(nodes: HistoryTreeNode[]): {
  steps: HistoryStepSummary[];
  toolCount: number;
} {
  const merged = new Map<string, HistoryStepSummary>();
  for (const node of nodes) {
    for (const step of node.steps) {
      const found = merged.get(step.key);
      if (!found) merged.set(step.key, { ...step });
      else {
        found.count += step.count;
        if (step.tone === "destructive") found.tone = "destructive";
      }
    }
  }
  const steps = [...merged.values()].sort(
    (a, b) => Number(b.tool) - Number(a.tool) || b.count - a.count,
  );
  return {
    steps,
    toolCount: steps.reduce((sum, s) => sum + (s.tool ? s.count : 0), 0),
  };
}

function lastReply(members: HistoryTreeNode[]): HistoryTreeNode | undefined {
  for (let i = members.length - 1; i > 0; i--) {
    const node = members[i]!;
    if (node.descriptor?.type === "assistant") return node;
  }
  const tail = members.at(-1);
  return tail && members.length > 1 ? tail : undefined;
}

function itemFor(
  anchor: HistoryTreeNode,
  members: HistoryTreeNode[],
  regionHead: boolean,
  childIds: string[],
  parentId: string | undefined,
): HistoryItem {
  const tail = members.at(-1)!;
  return {
    id: anchor.id,
    node: anchor,
    targetId: tail.id,
    members,
    reply: lastReply(members),
    ...mergeSteps(members),
    parentId,
    childIds,
    current: anchor.current,
    head: regionHead,
    startedAt: anchor.entry?.createdAt,
    endedAt: tail.entry?.createdAt ?? anchor.entry?.createdAt,
  };
}

/**
 * Group the message-level tree into list items. In "steps" mode every node is
 * an item; in "messages" mode a turn (a user message and the replies that
 * follow it) is one item, so the list reads as the user's messages.
 */
export function buildHistoryItems(
  tree: HistoryTree,
  mode: HistoryMode,
): HistoryItems {
  const items = new Map<string, HistoryItem>();
  const order: string[] = [];
  if (mode === "steps") {
    for (const id of tree.order) {
      const node = tree.nodes.get(id)!;
      items.set(
        id,
        itemFor(node, [node], node.head, [...node.childIds], node.parentId),
      );
      order.push(id);
    }
    return { items, order, rootId: HISTORY_ROOT_ID, headId: tree.headId };
  }

  const isAnchor = (node: HistoryTreeNode) =>
    node.id === HISTORY_ROOT_ID || node.kind === "user";
  let headId = HISTORY_ROOT_ID;
  const stack: { id: string; parentId?: string }[] = [{ id: HISTORY_ROOT_ID }];
  while (stack.length) {
    const { id, parentId } = stack.pop()!;
    const anchor = tree.nodes.get(id)!;
    // The continuing path of the turn: follow the last child while it is a reply.
    const members = [anchor];
    for (
      let next = tree.nodes.get(anchor.childIds.at(-1) ?? "");
      next && !isAnchor(next);
      next = tree.nodes.get(next.childIds.at(-1) ?? "")
    ) {
      members.push(next);
    }
    // Every user message reachable through replies opens a child turn,
    // including those under alternative replies.
    const childIds: string[] = [];
    let regionHead = anchor.head;
    const region = [...anchor.childIds];
    while (region.length) {
      const node = tree.nodes.get(region.shift()!)!;
      if (isAnchor(node)) childIds.push(node.id);
      else {
        regionHead ||= node.head;
        region.unshift(...node.childIds);
      }
    }
    childIds.sort(
      (a, b) =>
        Number(tree.nodes.get(a)!.current) - Number(tree.nodes.get(b)!.current),
    );
    const item = itemFor(anchor, members, regionHead, childIds, parentId);
    items.set(id, item);
    order.push(id);
    if (regionHead) headId = id;
    for (let i = childIds.length - 1; i >= 0; i--)
      stack.push({ id: childIds[i]!, parentId: id });
  }
  return { items, order, rootId: HISTORY_ROOT_ID, headId };
}

/** A lane line segment; `current` lines are drawn in the brand colour. */
export type HistoryLane = { lane: number; current: boolean };

export type HistoryRow = {
  itemId: string;
  lane: number;
  /** Set when the row stands for a whole folded side branch. */
  folded?: { count: number };
  /** Lines of other branches passing through the row. */
  pass: HistoryLane[];
  /** Line from the top of the row into the dot (undefined: none). */
  up?: boolean;
  /** Line from the dot to the bottom of the row (undefined: none). */
  down?: boolean;
  /** Side branches that start below this row. */
  forks: HistoryLane[];
};

export type HistoryRowLayout = { rows: HistoryRow[]; laneCount: number };

/** Lay items out as rows. Items in `folded` collapse with their subtree. */
export function layoutHistoryRows(
  model: HistoryItems,
  folded: ReadonlySet<string> = new Set(),
): HistoryRowLayout {
  const { items } = model;
  const rows: HistoryRow[] = [];
  const active = new Map<number, boolean>();
  let laneCount = 1;
  const passing = () =>
    [...active].map(([lane, current]) => ({ lane, current }));
  const freeLane = (from: number) => {
    let lane = from;
    while (active.has(lane)) lane += 1;
    laneCount = Math.max(laneCount, lane + 1);
    return lane;
  };

  const emitBranch = (startId: string, lane: number): void => {
    if (folded.has(startId)) {
      rows.push({
        itemId: startId,
        lane,
        folded: { count: subtreeSize(model, startId) },
        pass: passing(),
        up: items.get(startId)!.current,
        forks: [],
      });
      return;
    }
    for (let id: string | undefined = startId; id;) {
      const item: HistoryItem = items.get(id)!;
      const main = item.childIds.at(-1);
      const sides = item.childIds.slice(0, -1);
      const row: HistoryRow = {
        itemId: id,
        lane,
        pass: passing(),
        up: item.parentId ? item.current : undefined,
        down: main ? items.get(main)!.current : undefined,
        forks: [],
      };
      rows.push(row);
      if (sides.length) {
        active.set(lane, items.get(main!)!.current);
        const sideLanes = sides.map((side) => {
          const sideLane = freeLane(lane + 1);
          active.set(sideLane, items.get(side)!.current);
          return sideLane;
        });
        row.forks = sideLanes.map((sideLane, index) => ({
          lane: sideLane,
          current: items.get(sides[index]!)!.current,
        }));
        sides.forEach((side, index) => {
          active.delete(sideLanes[index]!);
          emitBranch(side, sideLanes[index]!);
        });
        active.delete(lane);
      }
      id = main;
    }
  };
  emitBranch(model.rootId, 0);
  return { rows, laneCount };
}

/** Number of items in the subtree rooted at `id`, itself included. */
export function subtreeSize(model: HistoryItems, id: string): number {
  let count = 0;
  const stack = [id];
  while (stack.length) {
    const item = model.items.get(stack.pop()!);
    if (!item) continue;
    count += 1;
    stack.push(...item.childIds);
  }
  return count;
}

/**
 * Side branches folded by default: those with at least `minSize` items that
 * contain none of the `keep` items (head, selection, search matches).
 */
export function defaultFoldedBranches(
  model: HistoryItems,
  keep: ReadonlySet<string>,
  minSize = 3,
): Set<string> {
  const size = new Map<string, number>();
  const kept = new Map<string, boolean>();
  for (const id of [...model.order].reverse()) {
    const item = model.items.get(id)!;
    let total = 1;
    let holds = keep.has(id) || item.head;
    for (const child of item.childIds) {
      total += size.get(child) ?? 0;
      holds ||= kept.get(child) ?? false;
    }
    size.set(id, total);
    kept.set(id, holds);
  }
  const folded = new Set<string>();
  for (const id of model.order) {
    const item = model.items.get(id)!;
    for (const side of item.childIds.slice(0, -1)) {
      if ((size.get(side) ?? 0) >= minSize && !kept.get(side)) folded.add(side);
    }
  }
  return folded;
}

/** Items after `id` on the current path that a rewind would move aside. */
export function itemsAfterOnCurrentPath(
  model: HistoryItems,
  id: string,
): number {
  const start = model.items.get(id);
  if (!start?.current || start.head) return 0;
  let count = 0;
  for (
    let next = model.items.get(start.childIds.at(-1) ?? "");
    next?.current;
    next = model.items.get(next.childIds.at(-1) ?? "")
  ) {
    count += 1;
    if (next.head) break;
  }
  return count;
}

/** Item ids whose messages mention the query (two characters or more). */
export function matchHistoryItems(
  model: HistoryItems,
  query: string,
): Set<string> {
  const needle = query.trim().toLowerCase();
  const matches = new Set<string>();
  if (needle.length < 2) return matches;
  for (const id of model.order) {
    const item = model.items.get(id)!;
    const hit = item.members.some((node) => {
      const entry = node.entry;
      if (!entry) return false;
      return [entry.summary, entry.text, ...node.folded.map((f) => f.text)]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(needle));
    });
    if (hit) matches.add(id);
  }
  return matches;
}

/** Compact span between two timestamps, e.g. "45s", "3m 12s", "2h 5m". */
export function historySpanLabel(
  from: string | undefined,
  to: string | undefined,
): string | undefined {
  if (!from || !to) return undefined;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 1000) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
