import { listDirectories } from "$lib/api";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  openProjectDirectory,
  selectProject,
  workspaceState,
} from "$lib/application/workspace";
import { pathKey } from "$lib/domain/filesystem/project-path";
import {
  loadFilesystemLocations,
  parentPath,
  resolveTypedPath,
} from "$lib/features/projects";
import { getDesktopBridge, isLocalDesktopDaemon } from "$lib/platform/desktop";

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Show Nerve's folder browser, optionally starting at `path`. */
export function openFolderBrowser(path?: string): void {
  workspaceState.projectPickerPath = path;
  workspaceState.projectPickerOpen = true;
}

/**
 * Open a folder as a project from a typed or system-picked path. The daemon
 * resolves it first, so a bad path reports a precise reason and offers the
 * browser at the nearest parent instead of failing generically.
 */
export async function openFolderPath(raw: string): Promise<void> {
  const locations = await loadFilesystemLocations().catch(() => undefined);
  const path = locations ? resolveTypedPath(raw, locations) : raw.trim();
  if (!path) return;
  const caseInsensitive = locations?.caseInsensitive ?? false;
  const findKnown = (candidate: string) =>
    workspaceState.projects.find(
      (project) =>
        pathKey(project.directory, caseInsensitive) ===
        pathKey(candidate, caseInsensitive),
    );

  const known = findKnown(path);
  if (known) {
    await selectProject(known.id);
    return;
  }
  let resolved: string;
  try {
    resolved = (await listDirectories(path)).path;
  } catch (caught) {
    const parent = locations ? parentPath(path, locations) : undefined;
    notify.error("Could not open folder", {
      description: messageOf(caught),
      action: {
        label: "Browse in Nerve",
        onClick: () => openFolderBrowser(parent || undefined),
      },
    });
    return;
  }
  const canonical = findKnown(resolved);
  if (canonical) await selectProject(canonical.id);
  else await openProjectDirectory(resolved);
}

/** The OS picker is only truthful when the shell and daemon share a filesystem. */
export async function canUseSystemPicker(): Promise<boolean> {
  return (
    typeof getDesktopBridge()?.dialog?.pickDirectory === "function" &&
    (await isLocalDesktopDaemon())
  );
}

/** Pick a folder with the OS dialog and open it; cancelling does nothing. */
export async function openFolderWithSystemPicker(
  /** A project folder; the dialog starts in its parent. */
  startFrom?: string,
): Promise<void> {
  const pick = getDesktopBridge()?.dialog?.pickDirectory;
  if (!pick) return;
  const locations = await loadFilesystemLocations().catch(() => undefined);
  const defaultPath =
    (startFrom && locations ? parentPath(startFrom, locations) : undefined) ||
    undefined;
  let picked: string | undefined;
  try {
    picked = (await pick({ title: "Open folder", defaultPath })).path;
  } catch (caught) {
    notify.error("Could not open the system picker", {
      description: messageOf(caught),
      action: { label: "Browse in Nerve", onClick: () => openFolderBrowser() },
    });
    return;
  }
  if (picked) await openFolderPath(picked);
}
