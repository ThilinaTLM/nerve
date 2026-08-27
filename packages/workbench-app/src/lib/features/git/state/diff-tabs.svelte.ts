import type { GitDiffArea } from "@nervekit/contracts";
import { diffViewKey } from "$lib/kernel/navigation/view-keys";
import { getGitFileDiff } from "$lib/features/git/api/git.api";
import {
  fileViewerPreferences,
  setWrapLongLines,
} from "$lib/application/workspace/file-viewer-preferences.svelte";
import {
  gitState,
  type DiffViewState,
} from "$lib/features/git/state/git-state.svelte";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

export function encodeDiffTabId(input: {
  projectId: string;
  repo: string;
  path: string;
  area: GitDiffArea;
}): string {
  return `${input.projectId}:${encodeURIComponent(input.repo)}:${input.area}:${encodeURIComponent(input.path)}`;
}

function addDiffTab(id: string): void {
  addCenterTab({ kind: "diff", id });
}

async function loadDiffView(
  view: DiffViewState,
  critical = false,
): Promise<void> {
  const initial = !view.data;
  if (initial) view.loading = true;
  else view.refreshing = true;
  view.error = undefined;
  try {
    view.data = await getGitFileDiff(
      view.projectId,
      view.repo,
      view.path,
      view.area,
    );
    view.path = view.data.path;
    view.renamedFrom = view.data.renamedFrom;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.error = message;
    if (critical) showCriticalError("Could not load diff", message);
  } finally {
    view.loading = false;
    view.refreshing = false;
  }
}

export async function openDiffPane(input: {
  projectId: string;
  repo: string;
  path: string;
  renamedFrom?: string;
  area: GitDiffArea;
}): Promise<void> {
  if (input.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/application/workspace/workspace-actions.svelte");
    await selectProject(input.projectId);
  }
  const id = encodeDiffTabId(input);
  const key = diffViewKey(id);
  gitState.diffViews[key] ??= {
    id,
    ...input,
    wrapLines: fileViewerPreferences.wrapLongLines,
    loading: false,
    refreshing: false,
  };
  addDiffTab(id);
  setActiveCenterTab({ kind: "diff", id });
  await loadDiffView(gitState.diffViews[key], true);
}

export async function selectCenterDiffTab(id: string): Promise<void> {
  const view = gitState.diffViews[diffViewKey(id)];
  if (!view) return;
  addDiffTab(id);
  setActiveCenterTab({ kind: "diff", id });
  if (!view.data && !view.loading) await loadDiffView(view);
}

export async function refreshDiffPane(id: string): Promise<void> {
  const view = gitState.diffViews[diffViewKey(id)];
  if (view && !view.loading && !view.refreshing) await loadDiffView(view, true);
}

export function toggleDiffLineWrap(id: string): void {
  const view = gitState.diffViews[diffViewKey(id)];
  if (!view) return;
  const next = !view.wrapLines;
  view.wrapLines = next;
  setWrapLongLines(next);
}

export function closeDiffTab(id: string): void {
  const tab = { kind: "diff" as const, id };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "diff" &&
    workspaceState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete gitState.diffViews[diffViewKey(id)];
  if (closingActive) void selectCenterTab(fallback);
}
