export type PanelTreeItemNode<T> = {
  kind: "item";
  id: string;
  label: string;
  path: readonly string[];
  value: T;
  /** Nested items; empty for leaves or not-yet-loaded parents. */
  children: readonly PanelTreeNode<T>[];
  /** Marks an item expandable before lazy children have been loaded. */
  expandable?: boolean;
};

export type PanelTreeGroupNode<T> = {
  kind: "group";
  id: string;
  label: string;
  path: readonly string[];
  children: readonly PanelTreeNode<T>[];
};

export type PanelTreeNode<T> = PanelTreeItemNode<T> | PanelTreeGroupNode<T>;

export type PanelTreeRow<T> = {
  node: PanelTreeNode<T>;
  depth: number;
  parentId?: string;
  posInSet: number;
  setSize: number;
};

export type BuildPanelTreeOptions<T> = {
  getPath: (item: T) => readonly string[];
  getKey: (item: T, index: number) => string;
  compareLabels?: (left: string, right: string) => number;
};

export type BuildPanelItemTreeOptions<T> = {
  getKey: (item: T) => string;
  getParentKey: (item: T) => string | undefined;
  getLabel: (item: T) => string;
  isExpandable?: (item: T) => boolean;
};

type TrieItem<T> = {
  value: T;
  id: string;
  label: string;
  path: readonly string[];
};

type TrieNode<T> = {
  segment: string;
  path: readonly string[];
  directories: Map<string, TrieNode<T>>;
  items: TrieItem<T>[];
};

const defaultCompareLabels = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

function groupId(path: readonly string[]): string {
  return `group:${JSON.stringify(path)}`;
}

function sortNodes<T>(
  nodes: PanelTreeNode<T>[],
  compareLabels: (left: string, right: string) => number,
): PanelTreeNode<T>[] {
  return nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "group" ? -1 : 1;
    return (
      compareLabels(left.label, right.label) || left.id.localeCompare(right.id)
    );
  });
}

function projectDirectory<T>(
  start: TrieNode<T>,
  compareLabels: (left: string, right: string) => number,
): PanelTreeGroupNode<T> {
  const labels = [start.segment];
  let current = start;

  while (current.items.length === 0 && current.directories.size === 1) {
    const child = current.directories.values().next().value as
      | TrieNode<T>
      | undefined;
    if (!child) break;
    labels.push(child.segment);
    current = child;
  }

  const children: PanelTreeNode<T>[] = [
    ...[...current.directories.values()].map((directory) =>
      projectDirectory(directory, compareLabels),
    ),
    ...current.items.map<PanelTreeItemNode<T>>((item) => ({
      kind: "item",
      id: item.id,
      label: item.label,
      path: item.path,
      value: item.value,
      children: [],
    })),
  ];

  return {
    kind: "group",
    id: groupId(current.path),
    label: labels.join("/"),
    path: current.path,
    children: sortNodes(children, compareLabels),
  };
}

export function buildPanelTree<T>(
  items: readonly T[],
  options: BuildPanelTreeOptions<T>,
): PanelTreeNode<T>[] {
  const compareLabels = options.compareLabels ?? defaultCompareLabels;
  const root: TrieNode<T> = {
    segment: "",
    path: [],
    directories: new Map(),
    items: [],
  };

  items.forEach((item, index) => {
    const path = [...options.getPath(item)];
    if (path.length === 0) return;

    const label = path.at(-1) ?? "";
    let directory = root;
    for (const segment of path.slice(0, -1)) {
      const childPath = [...directory.path, segment];
      let child = directory.directories.get(segment);
      if (!child) {
        child = {
          segment,
          path: childPath,
          directories: new Map(),
          items: [],
        };
        directory.directories.set(segment, child);
      }
      directory = child;
    }

    directory.items.push({
      value: item,
      id: `item:${options.getKey(item, index)}`,
      label,
      path,
    });
  });

  return sortNodes(
    [
      ...[...root.directories.values()].map((directory) =>
        projectDirectory(directory, compareLabels),
      ),
      ...root.items.map<PanelTreeItemNode<T>>((item) => ({
        kind: "item",
        id: item.id,
        label: item.label,
        path: item.path,
        value: item.value,
        children: [],
      })),
    ],
    compareLabels,
  );
}

/**
 * Builds a forest from parent-keyed items. Sibling order follows input order, so
 * callers own the sorting. Items with a missing, unknown, self, or cyclic parent
 * key become roots; every input key appears exactly once.
 */
export function buildPanelItemTree<T>(
  items: readonly T[],
  options: BuildPanelItemTreeOptions<T>,
): PanelTreeNode<T>[] {
  const byKey = new Map<string, T>();
  const ordered: T[] = [];
  for (const item of items) {
    const key = options.getKey(item);
    if (byKey.has(key)) continue;
    byKey.set(key, item);
    ordered.push(item);
  }

  const linkedParentKey = (item: T): string | undefined => {
    const key = options.getKey(item);
    const parentKey = options.getParentKey(item);
    if (!parentKey || parentKey === key || !byKey.has(parentKey))
      return undefined;

    const seen = new Set<string>([key]);
    let cursor: string | undefined = parentKey;
    while (cursor) {
      if (seen.has(cursor)) return undefined;
      seen.add(cursor);
      const ancestor = byKey.get(cursor);
      const next = ancestor ? options.getParentKey(ancestor) : undefined;
      cursor = next && byKey.has(next) ? next : undefined;
    }
    return parentKey;
  };

  const roots: T[] = [];
  const childrenByKey = new Map<string, T[]>();
  for (const item of ordered) {
    const parentKey = linkedParentKey(item);
    if (!parentKey) {
      roots.push(item);
      continue;
    }
    const siblings = childrenByKey.get(parentKey);
    if (siblings) siblings.push(item);
    else childrenByKey.set(parentKey, [item]);
  }

  const buildNodes = (
    siblings: readonly T[],
    parentPath: readonly string[],
  ): PanelTreeNode<T>[] =>
    siblings.map<PanelTreeItemNode<T>>((item) => {
      const key = options.getKey(item);
      const label = options.getLabel(item);
      const path = [...parentPath, label];
      return {
        kind: "item",
        id: `item:${key}`,
        label,
        path,
        value: item,
        children: buildNodes(childrenByKey.get(key) ?? [], path),
        expandable: options.isExpandable?.(item),
      };
    });

  return buildNodes(roots, []);
}

/** Ids of rows that can expand: group nodes and item nodes with children. */
export function panelTreeExpandableIds<T>(
  nodes: readonly PanelTreeNode<T>[],
): Set<string> {
  const ids = new Set<string>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.children.length > 0 || (node.kind === "item" && node.expandable))
      ids.add(node.id);
    stack.push(...node.children);
  }
  return ids;
}

export function expandedPanelTreeIds(
  expandableIds: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
): Set<string> {
  return new Set([...expandableIds].filter((id) => !collapsed.has(id)));
}

export function visiblePanelTreeRows<T>(
  nodes: readonly PanelTreeNode<T>[],
  expanded: ReadonlySet<string>,
): PanelTreeRow<T>[] {
  const rows: PanelTreeRow<T>[] = [];
  const stack: Array<{
    siblings: readonly PanelTreeNode<T>[];
    index: number;
    depth: number;
    parentId?: string;
  }> = [{ siblings: nodes, index: 0, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (!frame) break;
    if (frame.index >= frame.siblings.length) {
      stack.pop();
      continue;
    }
    const index = frame.index++;
    const node = frame.siblings[index];
    if (!node) continue;
    rows.push({
      node,
      depth: frame.depth,
      parentId: frame.parentId,
      posInSet: index + 1,
      setSize: frame.siblings.length,
    });
    if (node.children.length > 0 && expanded.has(node.id)) {
      stack.push({
        siblings: node.children,
        index: 0,
        depth: frame.depth + 1,
        parentId: node.id,
      });
    }
  }
  return rows;
}

export function adjacentPanelTreeRowId<T>(
  rows: readonly PanelTreeRow<T>[],
  currentId: string | undefined,
  direction: "next" | "previous" | "first" | "last",
): string | undefined {
  if (rows.length === 0) return undefined;
  if (direction === "first") return rows[0]?.node.id;
  if (direction === "last") return rows.at(-1)?.node.id;

  const currentIndex = rows.findIndex((row) => row.node.id === currentId);
  if (currentIndex === -1) return rows[0]?.node.id;
  const offset = direction === "next" ? 1 : -1;
  return rows[Math.max(0, Math.min(rows.length - 1, currentIndex + offset))]
    ?.node.id;
}

export function firstPanelTreeChildId<T>(
  rows: readonly PanelTreeRow<T>[],
  parentId: string,
): string | undefined {
  return rows.find((row) => row.parentId === parentId)?.node.id;
}

export function parentPanelTreeRowId<T>(
  rows: readonly PanelTreeRow<T>[],
  currentId: string,
): string | undefined {
  return rows.find((row) => row.node.id === currentId)?.parentId;
}
