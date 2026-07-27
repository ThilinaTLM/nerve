export type PanelTreeItemNode<T> = {
  kind: "item";
  id: string;
  label: string;
  path: readonly string[];
  value: T;
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
      })),
    ],
    compareLabels,
  );
}

export function panelTreeGroupIds<T>(
  nodes: readonly PanelTreeNode<T>[],
): Set<string> {
  const ids = new Set<string>();
  const visit = (node: PanelTreeNode<T>): void => {
    if (node.kind !== "group") return;
    ids.add(node.id);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

export function expandedPanelTreeGroupIds(
  groupIds: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
): Set<string> {
  return new Set([...groupIds].filter((id) => !collapsed.has(id)));
}

export function visiblePanelTreeRows<T>(
  nodes: readonly PanelTreeNode<T>[],
  expanded: ReadonlySet<string>,
): PanelTreeRow<T>[] {
  const rows: PanelTreeRow<T>[] = [];

  const visit = (
    siblings: readonly PanelTreeNode<T>[],
    depth: number,
    parentId?: string,
  ): void => {
    siblings.forEach((node, index) => {
      rows.push({
        node,
        depth,
        parentId,
        posInSet: index + 1,
        setSize: siblings.length,
      });
      if (node.kind === "group" && expanded.has(node.id))
        visit(node.children, depth + 1, node.id);
    });
  };

  visit(nodes, 0);
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
