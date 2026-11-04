import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import { notify } from "$lib/application/notifications/notify.svelte";
import { confirmFileTabsAtPath } from "$lib/application/workspace";
import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import {
  copyProjectEntry,
  createProjectEntry,
  deleteProjectEntries,
  moveProjectEntry,
} from "../api/filesystem.api";
import { describeFileOperationError } from "./file-operation-errors";
import {
  discardFileExplorerPath,
  retargetFileExplorerPath,
} from "./file-explorer-actions.svelte";
import {
  baseName,
  duplicateName,
  joinPath,
  parentPath,
} from "./file-explorer-paths";
import { ensureFileExplorerProject } from "./file-explorer-state.svelte";
import {
  closeFileTabsAtPath,
  retargetFileTabsAtPath,
} from "./file-tabs.svelte";

export type FileOperationContext = {
  projectId: string;
  projectDirectory: string;
  /** Re-lists the loaded directories and Git status. */
  refresh: (directories: string[]) => Promise<void>;
  /** Pushes expansion changes to the live-update monitor. */
  syncMonitorDemand: () => void;
};

export type PathPair = { from: string; to: string };

function uniqueDirectories(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function describeNames(paths: readonly string[]): string {
  const [first] = paths;
  return paths.length === 1 && first
    ? `“${baseName(first)}”`
    : `${paths.length} items`;
}

/** Names present in `directory` (as last listed), for collision-free copies. */
export function listedNames(projectId: string, directory: string): Set<string> {
  const project = ensureFileExplorerProject(projectId);
  return new Set(
    (project.directories[directory]?.entries ?? []).map((e) => e.name),
  );
}

export async function createFileExplorerEntry(
  context: FileOperationContext,
  parent: string,
  kind: "file" | "directory",
  name: string,
): Promise<FilesystemProjectEntry> {
  const response = await createProjectEntry({
    projectId: context.projectId,
    parentPath: parent,
    name,
    kind,
  });
  await context.refresh([parent]);
  return response.entry;
}

/**
 * Moves entries one by one, following open tabs and expansion. Reports
 * failures per item and offers a single Undo (inverse moves) for what moved.
 */
export async function moveFileExplorerEntries(
  context: FileOperationContext,
  moves: readonly PathPair[],
  options: { undoable?: boolean; verb?: string } = {},
): Promise<PathPair[]> {
  const done: PathPair[] = [];
  let failure: unknown;
  for (const move of moves) {
    try {
      await moveProjectEntry(context.projectId, move.from, move.to);
      retargetFileExplorerPath(context.projectId, move.from, move.to);
      retargetFileTabsAtPath({
        projectId: context.projectId,
        from: move.from,
        to: move.to,
      });
      done.push(move);
    } catch (caught) {
      failure = caught;
      break;
    }
  }
  if (done.length > 0) {
    context.syncMonitorDemand();
    await context.refresh(
      uniqueDirectories(
        done.flatMap((move) => [parentPath(move.from), parentPath(move.to)]),
      ),
    );
  }
  const verb = options.verb ?? "Moved";
  if (failure) {
    notify.error(
      done.length > 0
        ? `${verb} ${done.length} of ${moves.length} items`
        : `Could not ${verb.toLowerCase().replace(/d$/, "")} ${describeNames(moves.map((m) => m.from))}`,
      { description: describeFileOperationError(failure) },
    );
  } else if (done.length > 0) {
    const undo = done.map(({ from, to }) => ({ from: to, to: from })).reverse();
    notify.success(`${verb} ${describeNames(done.map((m) => m.from))}`, {
      action:
        options.undoable === false
          ? undefined
          : {
              label: "Undo",
              onClick: () =>
                void moveFileExplorerEntries(context, undo, {
                  undoable: false,
                  verb: "Restored",
                }),
            },
    });
  }
  return done;
}

export async function copyFileExplorerEntries(
  context: FileOperationContext,
  copies: readonly PathPair[],
  options: { verb?: string } = {},
): Promise<PathPair[]> {
  const done: PathPair[] = [];
  let failure: unknown;
  for (const copy of copies) {
    try {
      await copyProjectEntry(context.projectId, copy.from, copy.to);
      done.push(copy);
    } catch (caught) {
      failure = caught;
      break;
    }
  }
  if (done.length > 0)
    await context.refresh(uniqueDirectories(done.map((c) => parentPath(c.to))));
  const verb = options.verb ?? "Copied";
  if (failure) {
    notify.error(`Could not copy ${describeNames(copies.map((c) => c.from))}`, {
      description: describeFileOperationError(failure),
    });
  } else if (done.length > 0) {
    notify.success(`${verb} ${describeNames(done.map((c) => c.from))}`);
  }
  return done;
}

/** Destination paths for copying `sources` into `target`, renaming on collision. */
export function planCopyNames(
  projectId: string,
  sources: ReadonlyArray<{ path: string; kind: "file" | "directory" }>,
  target: string,
): PathPair[] {
  const taken = listedNames(projectId, target);
  return sources.map((source) => {
    const name = baseName(source.path);
    const unique = taken.has(name)
      ? duplicateName(name, source.kind === "directory", taken)
      : name;
    taken.add(unique);
    return { from: source.path, to: joinPath(target, unique) };
  });
}

export type DeleteMethod = "trash" | "delete";

/** Trashes (desktop) or permanently deletes entries, closing their tabs. */
export async function deleteFileExplorerEntries(
  context: FileOperationContext,
  entries: readonly FilesystemProjectEntry[],
  method: DeleteMethod,
): Promise<void> {
  const removed: string[] = [];
  let failure: unknown;
  const bridge = method === "trash" ? getDesktopBridge() : undefined;
  if (method === "trash" && !bridge) return;
  try {
    for (const entry of entries) {
      const descendants = entry.kind === "directory";
      if (
        !(await confirmFileTabsAtPath({
          projectId: context.projectId,
          path: entry.path,
          descendants,
        }))
      )
        break;
      if (bridge) {
        await bridge.files.trashProjectEntry({
          root: context.projectDirectory,
          relativePath: entry.path,
        });
      } else {
        await deleteProjectEntries(context.projectId, [entry.path]);
      }
      closeFileTabsAtPath({
        projectId: context.projectId,
        path: entry.path,
        descendants,
      });
      discardFileExplorerPath(context.projectId, entry.path);
      removed.push(entry.path);
    }
  } catch (caught) {
    failure = caught;
  }
  if (removed.length > 0) {
    context.syncMonitorDemand();
    await context.refresh(uniqueDirectories(removed.map(parentPath)));
  }
  const names = describeNames(removed);
  if (failure) {
    notify.error(
      method === "trash"
        ? "Could not move entry to trash"
        : "Could not delete entry",
      { description: describeFileOperationError(failure) },
    );
  } else if (removed.length > 0) {
    notify.success(
      method === "trash" ? `Moved ${names} to trash` : `Deleted ${names}`,
    );
  }
}
