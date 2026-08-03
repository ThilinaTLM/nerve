import { listProjectEntries } from "$lib/features/filesystem/api/filesystem.api";
import {
  ensureFileExplorerProject,
  type FileExplorerDirectoryState,
} from "./file-explorer-state.svelte";
import { SvelteMap } from "svelte/reactivity";
import {
  fileExplorerEntryNodeId,
  type FileExplorerTreeItem,
} from "./file-explorer-tree";

const PAGE_SIZE = 500;
const REFRESH_CONCURRENCY = 4;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureDirectory(
  projectId: string,
  path: string,
): FileExplorerDirectoryState {
  const project = ensureFileExplorerProject(projectId);
  return (project.directories[path] ??= {
    path,
    entries: [],
    pagesLoaded: 0,
    loading: false,
    refreshing: false,
    generation: 0,
  });
}

async function requestPages(
  projectId: string,
  path: string,
  pageCount: number,
): Promise<{
  entries: FileExplorerDirectoryState["entries"];
  nextCursor?: string;
  pagesLoaded: number;
}> {
  const entries: FileExplorerDirectoryState["entries"] = [];
  let cursor: string | undefined;
  let pagesLoaded = 0;
  do {
    const response = await listProjectEntries({
      projectId,
      path: path || undefined,
      cursor,
      limit: PAGE_SIZE,
    });
    entries.push(...response.entries);
    cursor = response.nextCursor;
    pagesLoaded += 1;
  } while (cursor && pagesLoaded < pageCount);
  return { entries, nextCursor: cursor, pagesLoaded };
}

export async function loadFileExplorerDirectory(
  projectId: string,
  path: string,
  options: { append?: boolean; refresh?: boolean } = {},
): Promise<void> {
  const directory = ensureDirectory(projectId, path);
  if (directory.loading || directory.refreshing) return;
  const generation = ++directory.generation;
  const refreshing = options.refresh === true;
  if (refreshing) directory.refreshing = true;
  else directory.loading = true;
  directory.error = undefined;

  try {
    if (options.append && directory.nextCursor) {
      const response = await listProjectEntries({
        projectId,
        path: path || undefined,
        cursor: directory.nextCursor,
        limit: PAGE_SIZE,
      });
      if (directory.generation !== generation) return;
      const merged = new SvelteMap(
        directory.entries.map((entry) => [entry.path, entry]),
      );
      for (const entry of response.entries) merged.set(entry.path, entry);
      directory.entries = [...merged.values()];
      directory.nextCursor = response.nextCursor;
      directory.pagesLoaded += 1;
    } else {
      const result = await requestPages(
        projectId,
        path,
        refreshing ? Math.max(1, directory.pagesLoaded) : 1,
      );
      if (directory.generation !== generation) return;
      directory.entries = result.entries;
      directory.nextCursor = result.nextCursor;
      directory.pagesLoaded = result.pagesLoaded;
    }
  } catch (error) {
    if (directory.generation === generation) directory.error = messageOf(error);
  } finally {
    if (directory.generation === generation) {
      directory.loading = false;
      directory.refreshing = false;
    }
  }
}

export async function ensureFileExplorerRoot(projectId: string): Promise<void> {
  const project = ensureFileExplorerProject(projectId);
  const root = project.directories[""];
  if (root && !root.error) return;
  await loadFileExplorerDirectory(projectId, "");
}

export function setFileExplorerItemExpanded(
  projectId: string,
  item: FileExplorerTreeItem,
  expanded: boolean,
): void {
  if (item.type !== "entry" || item.entry.kind !== "directory") return;
  const project = ensureFileExplorerProject(projectId);
  const id = fileExplorerEntryNodeId(projectId, item.entry.path);
  if (expanded) {
    project.expandedIds.add(id);
    if (!project.directories[item.entry.path] && !item.entry.symlink)
      void loadFileExplorerDirectory(projectId, item.entry.path);
  } else {
    project.expandedIds.delete(id);
  }
}

export function activateFileExplorerItem(
  projectId: string,
  item: FileExplorerTreeItem,
): void {
  if (item.type === "load-more") {
    void loadFileExplorerDirectory(projectId, item.directoryPath, {
      append: true,
    });
  } else if (item.type === "error") {
    void loadFileExplorerDirectory(projectId, item.directoryPath, {
      refresh: true,
    });
  }
}

async function runBounded(tasks: Array<() => Promise<void>>): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      if (task) await task();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(REFRESH_CONCURRENCY, tasks.length) }, worker),
  );
}

export async function refreshFileExplorerProject(
  projectId: string,
): Promise<void> {
  const project = ensureFileExplorerProject(projectId);
  await runBounded(
    Object.keys(project.directories).map(
      (path) => () =>
        loadFileExplorerDirectory(projectId, path, { refresh: true }),
    ),
  );
}
