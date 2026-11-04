import type { FilesystemProjectEntry } from "@nervekit/contracts/filesystem";
import { SvelteSet } from "svelte/reactivity";

export type FileExplorerDirectoryState = {
  path: string;
  entries: FilesystemProjectEntry[];
  nextCursor?: string;
  pagesLoaded: number;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  generation: number;
  stale: boolean;
};

export type FileExplorerProjectState = {
  projectId: string;
  directories: Record<string, FileExplorerDirectoryState>;
  expandedIds: SvelteSet<string>;
};

export const fileExplorerState = $state({
  projects: {} as Record<string, FileExplorerProjectState>,
});

export function ensureFileExplorerProject(
  projectId: string,
): FileExplorerProjectState {
  fileExplorerState.projects[projectId] ??= {
    projectId,
    directories: {},
    expandedIds: new SvelteSet<string>(),
  };
  // Read the assigned value back through the deep state proxy. Returning the
  // raw right-hand side of `??=` would make later async mutations non-reactive.
  return fileExplorerState.projects[projectId];
}

/**
 * Latest request to reveal a path. The mounted Files panel observes it to sync
 * monitor demand, select the row and scroll it into view; an unmounted panel
 * handles it when it mounts.
 */
export const fileExplorerRevealRequest = $state({
  projectId: undefined as string | undefined,
  path: undefined as string | undefined,
  /** Auto reveal follows the editor without stealing keyboard focus. */
  focus: true,
  token: 0,
});
