import type { PanelTreeNode } from "./panel-tree.js";

/** Where a moved item lands relative to the target row. */
export type PanelReorderZone = "before" | "inside" | "after";

/** Keyboard moves: up/down among siblings, into the previous sibling, out of the parent. */
export type PanelReorderKey = "up" | "down" | "in" | "out";

/**
 * Opt-in reordering for `PanelTree` item rows (`buildPanelItemTree`). The tree
 * owns the gestures; the owner owns the model: validate with `canDrop` and
 * apply with `onMove`. The tree never mutates `nodes`.
 *
 * Mouse: drag a row onto the top/bottom edge of another row (`before`/`after`),
 * onto the middle of a row that can contain children (`inside`; containers use
 * quarter/half/quarter zones), or onto the empty area below the rows (`target`
 * undefined, zone `inside`: the top level). Dropping after an expanded
 * container is reported as `before` its first child.
 *
 * Keyboard (focused row): Alt+↑ / Alt+↓ move among siblings, Alt+→ moves into
 * the previous sibling container, Alt+← moves out after the parent.
 */
export type PanelTreeReorder<T> = {
  canDrag: (item: T) => boolean;
  /** Items moved together when `item` is dragged; defaults to `[item]`. Return the selection when it contains `item`. */
  getSources?: (item: T) => readonly T[];
  /** Whether the placement is valid; a falsy result shows no indicator and rejects the drop. */
  canDrop: (
    sources: readonly T[],
    target: T | undefined,
    zone: PanelReorderZone,
  ) => boolean;
  onMove: (
    sources: readonly T[],
    target: T | undefined,
    zone: PanelReorderZone,
  ) => void;
  /** A drag began; e.g. capture the catalog revision the placement is based on. */
  onDragStart?: (sources: readonly T[]) => void;
  onDragEnd?: () => void;
};

/** Pointer position within a row (0 top, 1 bottom) to a drop zone. */
export function panelReorderZone(
  ratio: number,
  canContain: boolean,
): PanelReorderZone {
  if (canContain)
    return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
  return ratio < 0.5 ? "before" : "after";
}

type ItemNode<T> = Extract<PanelTreeNode<T>, { kind: "item" }>;

export type PanelReorderLocation<T> = {
  node: ItemNode<T>;
  parent?: ItemNode<T>;
  siblings: readonly PanelTreeNode<T>[];
};

/** Item nodes by id with their parent and sibling list. Group nodes are skipped. */
export function indexPanelReorderNodes<T>(
  nodes: readonly PanelTreeNode<T>[],
): Map<string, PanelReorderLocation<T>> {
  const index = new Map<string, PanelReorderLocation<T>>();
  const visit = (
    siblings: readonly PanelTreeNode<T>[],
    parent?: ItemNode<T>,
  ) => {
    for (const node of siblings) {
      if (node.kind === "item") index.set(node.id, { node, parent, siblings });
      visit(node.children, node.kind === "item" ? node : undefined);
    }
  };
  visit(nodes);
  return index;
}

/** Whether items can be dropped inside the node. */
export function canContainPanelItems<T>(node: PanelTreeNode<T>): boolean {
  return (
    node.kind === "item" &&
    (node.children.length > 0 || node.expandable === true)
  );
}

/**
 * The slot below an open container is its first child, so "after" an expanded
 * container with children is reported as "before" that first child.
 */
export function normalizePanelReorderDrop<T>(
  node: ItemNode<T>,
  zone: PanelReorderZone,
  expanded: boolean,
): { node: ItemNode<T>; zone: PanelReorderZone } {
  if (zone !== "after" || !expanded) return { node, zone };
  const first = node.children.find((child) => child.kind === "item");
  return first?.kind === "item"
    ? { node: first, zone: "before" }
    : { node, zone };
}

/**
 * Target row and zone for a keyboard move of the focused row, skipping rows
 * that move along with it. Undefined when the move is impossible.
 */
export function panelReorderKeyDrop<T>(
  index: ReadonlyMap<string, PanelReorderLocation<T>>,
  id: string,
  key: PanelReorderKey,
  movingIds: ReadonlySet<string>,
): { node: ItemNode<T>; zone: PanelReorderZone } | undefined {
  const location = index.get(id);
  if (!location) return undefined;
  const { siblings, parent } = location;
  const at = siblings.indexOf(location.node);
  const free = (node: PanelTreeNode<T> | undefined): ItemNode<T> | undefined =>
    node?.kind === "item" && !movingIds.has(node.id) ? node : undefined;

  switch (key) {
    case "up": {
      for (let i = at - 1; i >= 0; i -= 1) {
        const node = free(siblings[i]);
        if (node) return { node, zone: "before" };
      }
      return undefined;
    }
    case "down": {
      for (let i = at + 1; i < siblings.length; i += 1) {
        const node = free(siblings[i]);
        if (node) return { node, zone: "after" };
      }
      return undefined;
    }
    case "in": {
      for (let i = at - 1; i >= 0; i -= 1) {
        const node = free(siblings[i]);
        if (node)
          return canContainPanelItems(node)
            ? { node, zone: "inside" }
            : undefined;
      }
      return undefined;
    }
    case "out":
      return parent && !movingIds.has(parent.id)
        ? { node: parent, zone: "after" }
        : undefined;
  }
}

/** Maps Alt+Arrow to a keyboard move. */
export function panelReorderKey(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
): PanelReorderKey | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return undefined;
  switch (event.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowRight":
      return "in";
    case "ArrowLeft":
      return "out";
    default:
      return undefined;
  }
}
