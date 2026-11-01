/**
 * Tidy-tree layout for the branch history graph.
 *
 * A single line of nodes stays in one vertical column. At a fork the children
 * split left and right under the parent (side branches first, the child that
 * continues the branch last) and then run vertically again. Width is counted
 * in leaf columns bottom-up and positions are placed top-down, both iteratively
 * so very long conversations never hit the call stack limit.
 */

/** Node box edge; the dot is smaller, this is the hit and handle box. */
export const HISTORY_NODE_SIZE = 12;
export const HISTORY_ROW_GAP = 30;
export const HISTORY_COLUMN_GAP = 220;
export const HISTORY_LABEL_MAX = 360;
/** Space kept between a label's end and the next node on the same row. */
const LABEL_GUTTER = 28;

export type HistoryLayoutInput = {
  root: string;
  /** Children per node. Order is left to right; unlisted nodes are leaves. */
  childrenOf: ReadonlyMap<string, readonly string[]>;
};

export type HistoryLayoutNode = {
  id: string;
  row: number;
  /** Horizontal centre of the node, in px. */
  x: number;
  /** Vertical centre of the node, in px. */
  y: number;
  /** Room for the label to the right before the next node on this row. */
  labelWidth: number;
};

export type HistoryLayout = {
  nodes: Map<string, HistoryLayoutNode>;
  /** Number of leaf columns the tree spans. */
  columns: number;
};

export function layoutHistoryTree(input: HistoryLayoutInput): HistoryLayout {
  const { root, childrenOf } = input;
  const kids = (id: string): readonly string[] => childrenOf.get(id) ?? [];

  // Pre-order walk; reversed, every child is seen before its parent.
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = [root];
  while (walk.length) {
    const id = walk.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const child of kids(id)) walk.push(child);
  }

  const width = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const children = kids(id).filter((child) => width.has(child));
    width.set(
      id,
      children.length === 0
        ? 1
        : children.length === 1
          ? width.get(children[0]!)!
          : children.reduce((sum, child) => sum + width.get(child)!, 0),
    );
  }

  const centers = new Map<string, { center: number; row: number }>();
  const stack: { id: string; center: number; row: number }[] = [
    { id: root, center: 0, row: 0 },
  ];
  while (stack.length) {
    const { id, center, row } = stack.pop()!;
    centers.set(id, { center, row });
    const children = kids(id).filter((child) => !centers.has(child));
    if (children.length === 1) {
      stack.push({ id: children[0]!, center, row: row + 1 });
      continue;
    }
    let left = center - width.get(id)! / 2;
    for (const child of children) {
      const span = width.get(child)!;
      stack.push({ id: child, center: left + span / 2, row: row + 1 });
      left += span;
    }
  }

  const nodes = new Map<string, HistoryLayoutNode>();
  const rows = new Map<number, HistoryLayoutNode[]>();
  for (const id of order) {
    const placed = centers.get(id);
    if (!placed) continue;
    const node: HistoryLayoutNode = {
      id,
      row: placed.row,
      x: placed.center * HISTORY_COLUMN_GAP,
      y: placed.row * HISTORY_ROW_GAP,
      labelWidth: HISTORY_LABEL_MAX,
    };
    nodes.set(id, node);
    const inRow = rows.get(node.row);
    if (inRow) inRow.push(node);
    else rows.set(node.row, [node]);
  }

  // Labels run right until the next node on the same row.
  for (const inRow of rows.values()) {
    inRow.sort((a, b) => a.x - b.x);
    for (let i = 0; i < inRow.length - 1; i++) {
      const node = inRow[i]!;
      const gap = inRow[i + 1]!.x - node.x - LABEL_GUTTER;
      node.labelWidth = Math.max(0, Math.min(HISTORY_LABEL_MAX, gap));
    }
  }

  return { nodes, columns: width.get(root) ?? 1 };
}
