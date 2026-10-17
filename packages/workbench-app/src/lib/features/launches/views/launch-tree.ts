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

export interface LaunchTreeRow {
  readonly node: LaunchTreeNode;
  readonly depth: number;
  readonly position: number;
  readonly setSize: number;
}

export type LaunchDropZone = "before" | "after" | "inside" | "root";

export interface LaunchDropPlan {
  readonly destinationFolderId: string | null;
  readonly beforeSibling: LaunchCatalogEntryRef | null;
  /** The item would land exactly where it already is. */
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

export function flattenLaunchTree(
  nodes: readonly LaunchTreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): LaunchTreeRow[] {
  return nodes.flatMap((node, index) => [
    { node, depth, position: index + 1, setSize: nodes.length },
    ...(node.kind === "folder" && expanded.has(node.id)
      ? flattenLaunchTree(node.children, expanded, depth + 1)
      : []),
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

/** Resolves a placement into the move request, or undefined when invalid. */
export function planLaunchMove(
  nodes: readonly LaunchTreeNode[],
  dragged: LaunchCatalogEntryRef,
  target: {
    readonly ref?: LaunchCatalogEntryRef;
    readonly zone: LaunchDropZone;
    /** Whether a folder target currently shows its children. */
    readonly expanded?: boolean;
  },
): LaunchDropPlan | undefined {
  const index = indexLaunchTree(nodes);
  const source = index.get(nodeKey(dragged));
  if (!source) return undefined;

  let destination: string | null;
  let anchor: LaunchCatalogEntryRef | null = null;
  const targetNode = target.ref ? index.get(nodeKey(target.ref)) : undefined;
  let zone = target.zone;

  if (zone === "root") destination = null;
  else {
    if (!targetNode || nodeKey(targetNode) === nodeKey(dragged))
      return undefined;
    // Below an open folder header the next slot is its first child.
    if (
      zone === "after" &&
      targetNode.kind === "folder" &&
      target.expanded &&
      targetNode.children.length > 0
    ) {
      zone = "inside";
      anchor = {
        kind: targetNode.children[0]!.kind,
        id: targetNode.children[0]!.id,
      };
    }
    if (zone === "inside") {
      if (targetNode.kind !== "folder") return undefined;
      destination = targetNode.id;
    } else destination = targetNode.parentId;
  }

  if (
    source.kind === "folder" &&
    destination !== null &&
    folderSubtreeIds(nodes, source.id).has(destination)
  )
    return undefined;

  const original = siblingsOf(nodes, destination);
  const remaining = original.filter(
    (node) => nodeKey(node) !== nodeKey(source),
  );
  let insertAt = remaining.length;
  if (zone === "before" || zone === "after") {
    const at = remaining.findIndex(
      (node) => nodeKey(node) === nodeKey(targetNode!),
    );
    insertAt = zone === "before" ? at : at + 1;
  } else if (anchor) {
    // First-child insertion; the anchor may be the dragged item itself.
    insertAt = 0;
  }
  const next = remaining[insertAt];
  const beforeSibling = next ? { kind: next.kind, id: next.id } : null;
  const currentAt = original.findIndex(
    (node) => nodeKey(node) === nodeKey(source),
  );
  return {
    destinationFolderId: destination,
    beforeSibling,
    noop: source.parentId === destination && currentAt === insertAt,
  };
}

/** One-step reorder within the current parent. */
export function planLaunchStep(
  nodes: readonly LaunchTreeNode[],
  ref: LaunchCatalogEntryRef,
  direction: "up" | "down",
): LaunchDropPlan | undefined {
  const node = indexLaunchTree(nodes).get(nodeKey(ref));
  if (!node) return undefined;
  const siblings = siblingsOf(nodes, node.parentId);
  const at = siblings.findIndex(
    (candidate) => candidate.id === node.id && candidate.kind === node.kind,
  );
  const insertAt = direction === "up" ? at - 1 : at + 2;
  if (at < 0 || (direction === "up" ? at === 0 : at === siblings.length - 1))
    return undefined;
  const anchor = siblings[insertAt];
  return {
    destinationFolderId: node.parentId,
    beforeSibling: anchor ? { kind: anchor.kind, id: anchor.id } : null,
    noop: false,
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

/** Human-readable drop destination for the live drag preview. */
export function describeLaunchDrop(
  nodes: readonly LaunchTreeNode[],
  plan: LaunchDropPlan,
): string {
  const index = indexLaunchTree(nodes);
  const where =
    plan.destinationFolderId === null
      ? "top level"
      : `“${
          launchFolderOptions(nodes).find(
            (option) => option.id === plan.destinationFolderId,
          )?.label ?? "folder"
        }”`;
  if (!plan.beforeSibling) return `at the end of ${where}`;
  const before = index.get(nodeKey(plan.beforeSibling));
  const name =
    before?.kind === "folder"
      ? before.folder.label
      : before?.entry.definition.label?.trim() ||
        before?.entry.definition.command ||
        "launch";
  return `in ${where}, before “${name}”`;
}
