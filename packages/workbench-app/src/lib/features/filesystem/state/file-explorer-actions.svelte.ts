import { listProjectEntries } from "$lib/features/filesystem/api/filesystem.api";
import {
  ensureFileExplorerProject,
  fileExplorerRevealRequest,
  type FileExplorerDirectoryState,
} from "./file-explorer-state.svelte";
import {
  filesPanelPreferences,
  setFilesPanelPreference,
} from "./files-panel-preferences.svelte";
import { retargetPath } from "./file-explorer-paths";
import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
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
  project.directories[path] ??= {
    path,
    entries: [],
    pagesLoaded: 0,
    loading: false,
    refreshing: false,
    generation: 0,
    stale: false,
  };
  return project.directories[path];
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
    directory.stale = false;
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
    if (item.entry.symlink) return;
    project.expandedIds.add(id);
    const directory = project.directories[item.entry.path];
    if (!directory || directory.stale)
      void loadFileExplorerDirectory(projectId, item.entry.path, {
        refresh: Boolean(directory),
      });
  } else {
    project.expandedIds.delete(id);
    for (const [path, directory] of Object.entries(project.directories)) {
      if (path === item.entry.path || path.startsWith(`${item.entry.path}/`))
        directory.stale = true;
    }
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

export function discardFileExplorerPath(projectId: string, path: string): void {
  const project = ensureFileExplorerProject(projectId);
  for (const directoryPath of Object.keys(project.directories)) {
    if (directoryPath === path || directoryPath.startsWith(`${path}/`))
      delete project.directories[directoryPath];
  }
  const nodeId = fileExplorerEntryNodeId(projectId, path);
  for (const expandedId of project.expandedIds) {
    if (expandedId === nodeId || expandedId.startsWith(`${nodeId}/`))
      project.expandedIds.delete(expandedId);
  }
}

export function monitoredFileExplorerDirectories(projectId: string): string[] {
  const project = ensureFileExplorerProject(projectId);
  const prefix = `file:${projectId}:`;
  return [
    "",
    ...[...project.expandedIds]
      .filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length)),
  ];
}

export async function refreshFileExplorerProject(
  projectId: string,
  directories?: readonly string[],
): Promise<void> {
  const project = ensureFileExplorerProject(projectId);
  const active = new SvelteSet(monitoredFileExplorerDirectories(projectId));
  const paths = directories
    ? [...new SvelteSet(directories)].filter((path) => active.has(path))
    : [...active];
  await runBounded(
    paths
      .filter((path) => project.directories[path])
      .map(
        (path) => () =>
          loadFileExplorerDirectory(projectId, path, { refresh: true }),
      ),
  );
}

export function collapseAllFileExplorerItems(projectId: string): void {
  const project = ensureFileExplorerProject(projectId);
  project.expandedIds.clear();
  for (const [path, directory] of Object.entries(project.directories)) {
    if (path !== "") directory.stale = true;
  }
}

/** Moves cached listings and expansion of `from` to `to` after a rename or move. */
export function retargetFileExplorerPath(
  projectId: string,
  from: string,
  to: string,
): void {
  const project = ensureFileExplorerProject(projectId);
  const fromId = fileExplorerEntryNodeId(projectId, from);
  const expanded = [...project.expandedIds].filter(
    (id) => id === fromId || id.startsWith(`${fromId}/`),
  );
  for (const id of expanded) {
    project.expandedIds.delete(id);
    project.expandedIds.add(
      fileExplorerEntryNodeId(
        projectId,
        retargetPath(id.slice(`file:${projectId}:`.length), from, to),
      ),
    );
  }
  for (const directoryPath of Object.keys(project.directories)) {
    if (directoryPath === from || directoryPath.startsWith(`${from}/`))
      delete project.directories[directoryPath];
  }
}

const REVEAL_POLL_MS = 40;
const REVEAL_MAX_POLLS = 125;

async function whenDirectoryIdle(
  projectId: string,
  path: string,
): Promise<FileExplorerDirectoryState | undefined> {
  const project = ensureFileExplorerProject(projectId);
  for (let poll = 0; poll < REVEAL_MAX_POLLS; poll += 1) {
    const directory = project.directories[path];
    if (directory && !directory.loading && !directory.refreshing)
      return directory;
    await new Promise((resolve) => setTimeout(resolve, REVEAL_POLL_MS));
  }
  return project.directories[path];
}

/** Loads `path`'s directory, then pages until `target` is listed. */
async function loadUntilListed(
  projectId: string,
  directoryPath: string,
  target: string,
): Promise<FilesystemProjectEntry | undefined> {
  const project = ensureFileExplorerProject(projectId);
  let directory: FileExplorerDirectoryState | undefined =
    project.directories[directoryPath];
  if (!directory) {
    await loadFileExplorerDirectory(projectId, directoryPath);
  } else if (directory.stale) {
    await loadFileExplorerDirectory(projectId, directoryPath, {
      refresh: true,
    });
  }
  directory = await whenDirectoryIdle(projectId, directoryPath);
  while (directory) {
    const found = directory.entries.find((entry) => entry.path === target);
    if (found) return found;
    if (!directory.nextCursor) return undefined;
    await loadFileExplorerDirectory(projectId, directoryPath, { append: true });
    directory = await whenDirectoryIdle(projectId, directoryPath);
    if (directory?.error) return undefined;
  }
  return undefined;
}

/**
 * Expands every ancestor of `path`, loads missing pages, then asks the Files
 * panel to select the row and scroll it into view. Resolves once the row is
 * part of the tree state; a missing path resolves without a request.
 *
 * Explicit reveals (the default) also lift the hidden-dotfile and hide-ignored
 * filters that would keep the row out of view; `auto` reveals never touch
 * preferences.
 */
export async function revealFileExplorerPath(
  projectId: string,
  path: string,
  options: { auto?: boolean } = {},
): Promise<void> {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return;
  const project = ensureFileExplorerProject(projectId);
  await ensureFileExplorerRoot(projectId);

  let listed: FilesystemProjectEntry | undefined;
  let directoryPath = "";
  const hiddenBy = { dotfile: false, ignored: false };
  for (const [index, segment] of segments.entries()) {
    const target = directoryPath ? `${directoryPath}/${segment}` : segment;
    listed = await loadUntilListed(projectId, directoryPath, target);
    if (!listed) return;
    if (listed.name.startsWith(".")) hiddenBy.dotfile = true;
    if (listed.ignored) hiddenBy.ignored = true;
    if (index < segments.length - 1) {
      if (listed.kind !== "directory" || listed.symlink) return;
      project.expandedIds.add(fileExplorerEntryNodeId(projectId, target));
      directoryPath = target;
    }
  }

  if (!options.auto) {
    if (hiddenBy.dotfile && !filesPanelPreferences.showDotfiles)
      setFilesPanelPreference("showDotfiles", true);
    if (hiddenBy.ignored && filesPanelPreferences.hideIgnored)
      setFilesPanelPreference("hideIgnored", false);
  }
  fileExplorerRevealRequest.projectId = projectId;
  fileExplorerRevealRequest.path = path;
  fileExplorerRevealRequest.focus = !options.auto;
  fileExplorerRevealRequest.token += 1;
}
