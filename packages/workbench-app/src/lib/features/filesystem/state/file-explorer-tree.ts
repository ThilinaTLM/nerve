import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import type { PanelTreeNode } from "$lib/presentation/panels";
import type { FileExplorerProjectState } from "./file-explorer-state.svelte";

export type FileExplorerEntryItem = {
  type: "entry";
  entry: FilesystemProjectEntry;
};

/** Inline editor row: creates a child of `parentPath`, or renames `entry`. */
export type FileExplorerEditorItem =
  | {
      type: "editor";
      mode: "create";
      kind: "file" | "directory";
      parentPath: string;
    }
  | {
      type: "editor";
      mode: "rename";
      parentPath: string;
      entry: FilesystemProjectEntry;
    };

export type FileExplorerLoadMoreItem = {
  type: "load-more";
  directoryPath: string;
  cursor: string;
};

export type FileExplorerErrorItem = {
  type: "error";
  directoryPath: string;
  message: string;
};

export type FileExplorerTreeItem =
  | FileExplorerEntryItem
  | FileExplorerEditorItem
  | FileExplorerLoadMoreItem
  | FileExplorerErrorItem;

export function fileExplorerEntryNodeId(
  projectId: string,
  path: string,
): string {
  return `file:${projectId}:${path}`;
}

export type FileExplorerTreeOptions = {
  /** Drop entries matched by ignore rules. */
  hideIgnored?: boolean;
  /** Drop entries whose name starts with a dot (including `.git`). */
  hideDotfiles?: boolean;
  /** Case-insensitive name filter over loaded entries; ancestors stay visible. */
  filter?: string;
  /** Directory that shows an inline "new entry" row first. */
  creating?: { parentPath: string; kind: "file" | "directory" };
};

export function isHiddenFileExplorerEntry(
  entry: FilesystemProjectEntry,
  options: FileExplorerTreeOptions,
): boolean {
  if (options.hideDotfiles && entry.name.startsWith(".")) return true;
  return Boolean(options.hideIgnored && entry.ignored);
}

function matchesFilter(name: string, filter: string): boolean {
  return name.toLowerCase().includes(filter);
}

function directoryChildren(
  project: FileExplorerProjectState,
  directoryPath: string,
  ancestorPaths: ReadonlySet<string>,
  options: FileExplorerTreeOptions,
  filter: string,
  filterExpanded: Set<string>,
): PanelTreeNode<FileExplorerTreeItem>[] {
  const directory = project.directories[directoryPath];
  if (!directory) return [];

  const nodes: PanelTreeNode<FileExplorerTreeItem>[] = [];
  if (
    options.creating &&
    options.creating.parentPath === directoryPath &&
    !filter
  ) {
    nodes.push({
      kind: "item",
      id: `file-editor:${project.projectId}:${directoryPath}`,
      label: "",
      path: [directoryPath, "new"],
      value: {
        type: "editor",
        mode: "create",
        kind: options.creating.kind,
        parentPath: directoryPath,
      },
      children: [],
    });
  }
  for (const entry of directory.entries) {
    if (isHiddenFileExplorerEntry(entry, options)) continue;
    const id = fileExplorerEntryNodeId(project.projectId, entry.path);
    const mayExpand = entry.kind === "directory" && !entry.symlink;
    const cyclic = mayExpand && ancestorPaths.has(entry.path);
    const nextAncestors = new Set(ancestorPaths).add(entry.path);
    const children =
      mayExpand && !cyclic
        ? directoryChildren(
            project,
            entry.path,
            nextAncestors,
            options,
            filter,
            filterExpanded,
          )
        : [];
    if (filter && !matchesFilter(entry.name, filter) && children.length === 0)
      continue;
    if (filter && children.length > 0) filterExpanded.add(id);
    nodes.push({
      kind: "item",
      id,
      label: entry.name,
      path: entry.path.split("/"),
      value: { type: "entry", entry },
      children,
      expandable: mayExpand && !cyclic,
    });
  }

  if (directory.error) {
    nodes.push({
      kind: "item",
      id: `file-error:${project.projectId}:${directoryPath}`,
      label: "Could not refresh directory",
      path: [directoryPath, "error"],
      value: { type: "error", directoryPath, message: directory.error },
      children: [],
    });
  }
  if (directory.nextCursor) {
    nodes.push({
      kind: "item",
      id: `file-more:${project.projectId}:${directoryPath}:${directory.nextCursor}`,
      label: directory.loading ? "Loading…" : "Load more…",
      path: [directoryPath, "more"],
      value: {
        type: "load-more",
        directoryPath,
        cursor: directory.nextCursor,
      },
      children: [],
    });
  }
  return nodes;
}

export function buildFileExplorerTree(
  project: FileExplorerProjectState,
  options: FileExplorerTreeOptions = {},
): PanelTreeNode<FileExplorerTreeItem>[] {
  return buildFileExplorerTreeView(project, options).nodes;
}

/**
 * Builds the tree plus the ids a name filter forces open so matches below
 * collapsed folders stay visible.
 */
export function buildFileExplorerTreeView(
  project: FileExplorerProjectState,
  options: FileExplorerTreeOptions = {},
): {
  nodes: PanelTreeNode<FileExplorerTreeItem>[];
  filterExpandedIds: ReadonlySet<string>;
} {
  const filter = options.filter?.trim().toLowerCase() ?? "";
  const filterExpanded = new Set<string>();
  const nodes = directoryChildren(
    project,
    "",
    new Set([""]),
    options,
    filter,
    filterExpanded,
  );
  return { nodes, filterExpandedIds: filterExpanded };
}
