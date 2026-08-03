import type { FilesystemProjectEntry } from "@nervekit/contracts";
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
