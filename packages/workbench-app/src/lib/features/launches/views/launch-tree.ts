import type {
  LaunchCatalogEntryRef,
  LaunchFolder,
} from "@nervekit/contracts/launch-definitions";
import type { LaunchDefinitionEntry } from "./launch-panel-types.js";

export type LaunchTreeNode =
  | {
      readonly kind: "folder";
      readonly id: string;
      readonly parentId: string | null;
      readonly folder: LaunchFolder;
      readonly children: LaunchTreeNode[];
      /** Distinct definitions below this folder with at least one active run. */
      readonly activeCount: number;
    }
  | {
      readonly kind: "definition";
      readonly id: string;
      readonly parentId: string | null;
      readonly entry: LaunchDefinitionEntry;
    };

/** Where a move lands relative to the target; no target means the top level. */
export type LaunchDropZone = "before" | "after" | "inside";

export interface LaunchMovePlan {
  readonly destinationFolderId: string | null;
  /** Anchor every entry is placed before (in order); null appends. */
  readonly beforeSibling: LaunchCatalogEntryRef | null;
  /** Entries to move, in tree order, without ones that travel inside a moved folder. */
  readonly entries: readonly LaunchCatalogEntryRef[];
  /** The entries would land exactly where they already are. */
  readonly noop: boolean;
}

export const nodeKey = (ref: LaunchCatalogEntryRef): string =>
  `${ref.kind}:${ref.id}`;

const byPlacement = (
  left: { readonly order: number; readonly id: string },
  right: { readonly order: number; readonly id: string },
): number => left.order - right.order || left.id.localeCompare(right.id);

/**
 * Builds the single mixed sibling list per parent from persisted placement.
 * Unknown parents fall back to the root so a record never disappears.
 */
export function buildLaunchTree(
  folders: readonly LaunchFolder[],
  entries: readonly LaunchDefinitionEntry[],
): LaunchTreeNode[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const parentOf = (parent: string | null): string | null =>
    parent !== null && folderIds.has(parent) ? parent : null;
  type Item = {
    order: number;
    id: string;
    kind: "folder" | "definition";
    folder?: LaunchFolder;
    entry?: LaunchDefinitionEntry;
  };
  const groups = new Map<string | null, Item[]>();
  const add = (parent: string | null, item: Item) => {
    const list = groups.get(parent) ?? [];
    list.push(item);
    groups.set(parent, list);
  };
  for (const folder of folders)
    add(parentOf(folder.parentFolderId), {
      order: folder.order,
      id: folder.id,
      kind: "folder",
      folder,
    });
  for (const entry of entries)
    add(parentOf(entry.definition.parentFolderId), {
      order: entry.definition.order,
      id: entry.definition.id,
      kind: "definition",
      entry,
    });

  const visiting = new Set<string>();
  const build = (parent: string | null): LaunchTreeNode[] =>
    (groups.get(parent) ?? [])
      .sort(byPlacement)
      .flatMap((item): LaunchTreeNode[] => {
        if (item.kind === "definition")
          return [
            {
              kind: "definition" as const,
              id: item.id,
              parentId: parent,
              entry: item.entry!,
            },
          ];
        if (visiting.has(item.id)) return [];
        visiting.add(item.id);
        const children = build(item.id);
        visiting.delete(item.id);
        return [
          {
            kind: "folder" as const,
            id: item.id,
            parentId: parent,
            folder: item.folder!,
            children,
            activeCount: children.reduce(
              (sum, child) =>
                sum +
                (child.kind === "folder"
                  ? child.activeCount
                  : child.entry.activeRuns.length > 0
                    ? 1
                    : 0),
              0,
            ),
          },
        ];
      });
  return build(null);
}

/** Every node in tree order (parents before children). */
export function flattenLaunchTree(
  nodes: readonly LaunchTreeNode[],
): LaunchTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.kind === "folder" ? flattenLaunchTree(node.children) : []),
  ]);
}

export function indexLaunchTree(
  nodes: readonly LaunchTreeNode[],
): Map<string, LaunchTreeNode> {
  const index = new Map<string, LaunchTreeNode>();
  const visit = (list: readonly LaunchTreeNode[]) => {
    for (const node of list) {
      index.set(nodeKey(node), node);
      if (node.kind === "folder") visit(node.children);
    }
  };
  visit(nodes);
  return index;
}

export function siblingsOf(
  nodes: readonly LaunchTreeNode[],
  parentId: string | null,
): readonly LaunchTreeNode[] {
  if (parentId === null) return nodes;
  const parent = indexLaunchTree(nodes).get(`folder:${parentId}`);
  return parent?.kind === "folder" ? parent.children : [];
}

/** Folder ids at or below `folderId`. */
export function folderSubtreeIds(
  nodes: readonly LaunchTreeNode[],
  folderId: string,
): Set<string> {
  const ids = new Set<string>();
  const root = indexLaunchTree(nodes).get(`folder:${folderId}`);
  const visit = (node: LaunchTreeNode) => {
    if (node.kind !== "folder") return;
    ids.add(node.id);
    node.children.forEach(visit);
  };
  if (root) visit(root);
  return ids;
}

/**
 * Resolves a placement of one or more entries into move requests, or undefined
 * when invalid (target among the moved entries, folder into its own subtree).
 * Entries are moved one by one before the same anchor, which keeps their order.
 */
export function planLaunchMoves(
  nodes: readonly LaunchTreeNode[],
  dragged: readonly LaunchCatalogEntryRef[],
  target: {
    readonly ref?: LaunchCatalogEntryRef;
    readonly zone: LaunchDropZone;
  },
): LaunchMovePlan | undefined {
  const index = indexLaunchTree(nodes);
  const draggedKeys = new Set(dragged.map(nodeKey));
  // A selected folder carries its selected descendants with it.
  const hasMovedAncestor = (node: LaunchTreeNode): boolean => {
    let parent = node.parentId;
    while (parent) {
      if (draggedKeys.has(`folder:${parent}`)) return true;
      parent = index.get(`folder:${parent}`)?.parentId ?? null;
    }
    return false;
  };
  const sources = flattenLaunchTree(nodes).filter(
    (node) => draggedKeys.has(nodeKey(node)) && !hasMovedAncestor(node),
  );
  if (sources.length === 0) return undefined;

  const targetNode = target.ref ? index.get(nodeKey(target.ref)) : undefined;
  let destination: string | null;
  if (!target.ref) destination = null;
  else {
    if (!targetNode || draggedKeys.has(nodeKey(targetNode))) return undefined;
    if (target.zone === "inside") {
      if (targetNode.kind !== "folder") return undefined;
      destination = targetNode.id;
    } else destination = targetNode.parentId;
  }

  if (destination !== null) {
    for (const source of sources) {
      if (
        source.kind === "folder" &&
        folderSubtreeIds(nodes, source.id).has(destination)
      )
        return undefined;
    }
  }

  const original = siblingsOf(nodes, destination);
  const remaining = original.filter((node) => !sources.includes(node));
  let insertAt = remaining.length;
  if (targetNode && target.zone !== "inside") {
    const at = remaining.indexOf(targetNode);
    if (at < 0) return undefined;
    insertAt = target.zone === "before" ? at : at + 1;
  }
  const next = remaining[insertAt];
  const result = [
    ...remaining.slice(0, insertAt),
    ...sources,
    ...remaining.slice(insertAt),
  ];
  return {
    destinationFolderId: destination,
    beforeSibling: next ? { kind: next.kind, id: next.id } : null,
    entries: sources.map((node) => ({ kind: node.kind, id: node.id })),
    noop:
      sources.every((node) => node.parentId === destination) &&
      result.length === original.length &&
      result.every((node, at) => node === original[at]),
  };
}

/** The placement of a one-slot keyboard/menu move within the current parent. */
export function launchStepTarget(
  nodes: readonly LaunchTreeNode[],
  ref: LaunchCatalogEntryRef,
  direction: "up" | "down",
): { ref: LaunchCatalogEntryRef; zone: LaunchDropZone } | undefined {
  const node = indexLaunchTree(nodes).get(nodeKey(ref));
  if (!node) return undefined;
  const siblings = siblingsOf(nodes, node.parentId);
  const at = siblings.indexOf(node);
  const neighbor = siblings[direction === "up" ? at - 1 : at + 1];
  return at < 0 || !neighbor
    ? undefined
    : {
        ref: { kind: neighbor.kind, id: neighbor.id },
        zone: direction === "up" ? "before" : "after",
      };
}

export interface LaunchFolderOption {
  readonly id: string;
  /** Full path such as `Apps / Web`. */
  readonly label: string;
  readonly depth: number;
}

/** Every folder in tree order, optionally excluding a subtree. */
export function launchFolderOptions(
  nodes: readonly LaunchTreeNode[],
  excludeSubtreeOf?: string,
): LaunchFolderOption[] {
  const options: LaunchFolderOption[] = [];
  const visit = (list: readonly LaunchTreeNode[], path: string[]) => {
    for (const node of list) {
      if (node.kind !== "folder" || node.id === excludeSubtreeOf) continue;
      const trail = [...path, node.folder.label];
      options.push({
        id: node.id,
        label: trail.join(" / "),
        depth: path.length,
      });
      visit(node.children, trail);
    }
  };
  visit(nodes, []);
  return options;
}
