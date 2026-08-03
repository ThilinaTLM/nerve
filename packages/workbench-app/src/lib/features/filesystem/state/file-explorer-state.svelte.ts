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
  return (fileExplorerState.projects[projectId] ??= {
    projectId,
    directories: {},
    expandedIds: new SvelteSet<string>(),
  });
}
