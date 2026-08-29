import type { FilesystemProjectEntry } from "@nervekit/contracts";
import type { PanelTreeNode } from "$lib/presentation/panels";
import type { FileExplorerProjectState } from "./file-explorer-state.svelte";

export type FileExplorerEntryItem = {
  type: "entry";
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
  | FileExplorerLoadMoreItem
  | FileExplorerErrorItem;

export function fileExplorerEntryNodeId(
  projectId: string,
  path: string,
): string {
  return `file:${projectId}:${path}`;
}

function directoryChildren(
  project: FileExplorerProjectState,
  directoryPath: string,
  ancestorPaths: ReadonlySet<string>,
): PanelTreeNode<FileExplorerTreeItem>[] {
  const directory = project.directories[directoryPath];
  if (!directory) return [];

  const nodes = directory.entries.map<PanelTreeNode<FileExplorerTreeItem>>(
    (entry) => {
      const id = fileExplorerEntryNodeId(project.projectId, entry.path);
      const mayExpand = entry.kind === "directory" && !entry.symlink;
      const cyclic = mayExpand && ancestorPaths.has(entry.path);
      const nextAncestors = new Set(ancestorPaths).add(entry.path);
      return {
        kind: "item",
        id,
        label: entry.name,
        path: entry.path.split("/"),
        value: { type: "entry", entry },
        children:
          mayExpand && !cyclic
            ? directoryChildren(project, entry.path, nextAncestors)
            : [],
        expandable: mayExpand && !cyclic,
      };
    },
  );

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
): PanelTreeNode<FileExplorerTreeItem>[] {
  return directoryChildren(project, "", new Set([""]));
}
