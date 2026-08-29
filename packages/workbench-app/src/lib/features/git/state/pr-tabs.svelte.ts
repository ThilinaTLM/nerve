import type { GithubPr, GithubPrMergeMethod } from "@nervekit/contracts";
import { prViewKey } from "$lib/domain/navigation/view-keys";
import {
  demandPrTab,
  loadPrCore,
  loadPrFileDiff,
  loadPrInitial,
  loadPrSection,
  refreshCurrentPr,
} from "$lib/features/git/state/git-refresh-coordinator.svelte";
import { openPrSummary } from "$lib/features/git/state/git-panel-state.svelte";
import {
  gitState,
  type PrResourceState,
  type PrViewState,
} from "$lib/features/git/state/git-state.svelte";
import {
  prChecksEqual,
  prCoreMatchesSummary,
} from "$lib/features/git/state/pr-sync";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

function encodePrTabId(
  projectId: string,
  repo: string,
  number: number,
): string {
  return `${projectId}:${encodeURIComponent(repo)}:${number}`;
}

function emptyResource<T>(): PrResourceState<T> {
  return { loading: false, refreshing: false };
}

function createPrView(input: {
  id: string;
  projectId: string;
  repo: string;
  number: number;
  summary?: GithubPr;
}): PrViewState {
  return {
    ...input,
    core: emptyResource(),
    conversation: emptyResource(),
    overview: emptyResource(),
    commits: emptyResource(),
    checks: emptyResource(),
    files: emptyResource(),
    fileDiffs: {},
    activeTab: "conversation",
    refreshing: false,
    merging: false,
  };
}

function addPrTab(id: string): void {
  addCenterTab({ kind: "pr", id });
}

async function ensurePrView(
  view: PrViewState,
  criticalErrorTitle?: string,
): Promise<void> {
  if (
    view.activeTab === "conversation" &&
    (!view.core.data || !view.conversation.data || !view.overview.data)
  ) {
    const initial = await loadPrInitial(view, {
      silent: Boolean(
        view.core.data || view.conversation.data || view.overview.data,
      ),
      criticalErrorTitle,
    });
    if (initial) demandPrTab(view);
    return;
  }
  await loadPrCore(view, {
    silent: Boolean(view.core.data),
    criticalErrorTitle,
  });
  demandPrTab(view);
}

export function syncOpenPrViews(
  projectId: string,
  repo: string,
  prs: GithubPr[],
): void {
  for (const view of Object.values(gitState.prViews)) {
    if (view.projectId !== projectId || view.repo !== repo) continue;
    const summary = prs.find((pr) => pr.number === view.number);
    if (!summary) continue;
    view.summary = summary;
    if (!prChecksEqual(view.checks.data?.checks, summary.checks)) {
      view.checks.data = { checks: summary.checks };
    }
    if (view.core.data && !prCoreMatchesSummary(view.core.data, summary)) {
      view.core.data = {
        ...view.core.data,
        title: summary.title,
        url: summary.url,
        state: summary.state,
        isDraft: summary.isDraft,
        headRefName: summary.headRefName,
        baseRefName: summary.baseRefName,
        updatedAt: summary.updatedAt,
      };
    }
  }
}

export async function openPrPane(input: {
  projectId: string;
  repo: string;
  number: number;
}): Promise<void> {
  if (input.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/application/workspace/workspace-actions.svelte");
    await selectProject(input.projectId);
  }
  const id = encodePrTabId(input.projectId, input.repo, input.number);
  const key = prViewKey(id);
  addPrTab(id);
  const summary = openPrSummary(input.projectId, input.repo, input.number);
  gitState.prViews[key] ??= createPrView({ id, ...input, summary });
  const view = gitState.prViews[key];
  if (summary) view.summary = summary;
  if (summary && !view.checks.data)
    view.checks.data = { checks: summary.checks };
  setActiveCenterTab({ kind: "pr", id });
  await ensurePrView(view, "Could not open pull request");
}

export async function selectCenterPrTab(id: string): Promise<void> {
  const view = gitState.prViews[prViewKey(id)];
  if (!view) return;
  addPrTab(id);
  setActiveCenterTab({ kind: "pr", id });
  await ensurePrView(view);
}

export async function refreshPrPane(id: string): Promise<void> {
  const view = gitState.prViews[prViewKey(id)];
  if (view) await refreshCurrentPr(view);
}

export async function loadPrFiles(id: string, force = false): Promise<void> {
  const view = gitState.prViews[prViewKey(id)];
  if (view) await loadPrSection(view, "files", { force });
}

export function selectPrTab(
  id: string,
  tab: "conversation" | "commits" | "checks" | "files",
): void {
  const view = gitState.prViews[prViewKey(id)];
  if (!view) return;
  view.activeTab = tab;
  void loadPrSection(view, tab, {
    criticalErrorTitle: "Could not load pull request section",
  });
  demandPrTab(view);
}

export function selectPrFile(id: string, path: string): void {
  const view = gitState.prViews[prViewKey(id)];
  if (!view) return;
  view.selectedFilePath = path;
  void loadPrFileDiff(view, path, { silent: true });
}

export function retrySelectedPrFile(id: string): void {
  const view = gitState.prViews[prViewKey(id)];
  if (view?.selectedFilePath)
    void loadPrFileDiff(view, view.selectedFilePath, {
      force: true,
      criticalErrorTitle: "Could not load pull request file",
    });
}

export function selectPrMergeMethod(
  id: string,
  method: GithubPrMergeMethod,
): void {
  const view = gitState.prViews[prViewKey(id)];
  if (view) view.selectedMergeMethod = method;
}

export function closePrTab(id: string): void {
  const tab = { kind: "pr" as const, id };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "pr" &&
    workspaceState.activeCenterTab.id === id;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete gitState.prViews[prViewKey(id)];
  if (closingActive) void selectCenterTab(fallback);
}
