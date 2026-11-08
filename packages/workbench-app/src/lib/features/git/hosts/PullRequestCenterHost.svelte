<script lang="ts">
import type { GithubPrMergeMethod } from "@nervekit/contracts/git";
import { startGitOperation, mergeGithubPr } from "$lib/api";
import { GitHubPrPane, type PrMergeFollowUp } from "$lib/features/git/views";
import { invalidateGit } from "$lib/features/git/state/git-context.svelte";
import {
  applyMergedPr,
  loadPrCore,
  loadPrSection,
  selectedPrFileDiffResource,
  setActivePrRefreshDemand,
} from "$lib/features/git/state/pr-view-loader.svelte";

import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
import { gitWorkspaceSnapshot } from "$lib/features/git/state/git-store.svelte";
import { removeGitRepoWorktree } from "$lib/features/git/state/git-panel-mutations.svelte";
import { prCheckout } from "$lib/features/git/views/git-repo-tree";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  refreshPrPane,
  retrySelectedPrFile,
  selectPrFile,
  selectPrMergeMethod,
  selectPrTab,
} from "$lib/features/git/state/pr-tabs.svelte";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import {
  fileViewerPreferences,
  setDiffLayout,
} from "$lib/application/workspace/file-viewer-preferences.svelte";
import { observeGitOperationStart } from "$lib/features/git/state/git-operation-tracking";
import { needsClientFailureNotice } from "$lib/features/git/state/pr-mutation-feedback";
import { queueMergedPrFollowUp } from "$lib/features/git/state/pr-merge-follow-up";

const activeCenterPrView = $derived(gitSelectors.activeCenterPrView);
const activeFileDiff = $derived(selectedPrFileDiffResource(activeCenterPrView));
/** The worktree of the PR's repository that has its head branch checked out. */
const checkout = $derived(
  activeCenterPrView
    ? prCheckout(
        gitWorkspaceSnapshot(activeCenterPrView.projectId)?.summaries ?? [],
        activeCenterPrView.repo,
        activeCenterPrView.core.data?.headRefName,
      )
    : undefined,
);

function prNoticeKey(
  view: { projectId: string; repo: string; number: number },
  operation: string,
): string {
  return `git.pr:${view.projectId}:${view.repo}:${view.number}:${operation}`;
}

function prNoticeScope(view: { projectId: string; repo: string }) {
  return { projectId: view.projectId, repositoryPath: view.repo };
}

function failureMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

async function copyActivePrLink() {
  const view = activeCenterPrView;
  const url = view?.core.data?.url ?? view?.summary?.url;
  if (!view || !url) return;
  const base = {
    key: prNoticeKey(view, "copy-link"),
    scope: prNoticeScope(view),
  };
  try {
    await writeClipboardText(url);
    activityInbox.notify({
      ...base,
      title: `Copied link to PR #${view.number}`,
      status: "succeeded",
    });
  } catch (caught) {
    activityInbox.notify({
      ...base,
      title: `Could not copy link to PR #${view.number}`,
      status: "failed",
      message: failureMessage(caught),
    });
  }
}

async function checkoutActivePr() {
  const view = activeCenterPrView;
  if (!view) return;
  try {
    const input = {
      projectId: view.projectId,
      repo: view.repo,
      kind: "checkout" as const,
      number: view.number,
    };
    const { operationId } = await startGitOperation(input);
    observeGitOperationStart(activityInbox, input, operationId);
    // Repository events refresh state after actual success; Activity owns progress/cancel.
  } catch (caught) {
    activityInbox.notify({
      key: prNoticeKey(view, "checkout"),
      title: `Could not start checkout of PR #${view.number}`,
      status: "failed",
      message: failureMessage(caught),
      scope: prNoticeScope(view),
    });
  }
}

async function mergeActivePr(
  method: GithubPrMergeMethod,
  followUp: PrMergeFollowUp,
) {
  const view = activeCenterPrView;
  const core = view?.core.data;
  if (!view || !core || view.merging) return;
  view.merging = true;
  const scope = prNoticeScope(view);
  const mergeKey = prNoticeKey(view, "merge");
  const postMergeFailure = (title: string, caught: unknown) =>
    activityInbox.notify({
      key: prNoticeKey(view, "merge-follow-up"),
      title,
      status: "failed",
      message: failureMessage(caught),
      scope,
    });

  try {
    try {
      await mergeGithubPr(
        view.projectId,
        view.repo,
        view.number,
        method,
        core.headRefOid,
      );
    } catch (caught) {
      // The server publishes its own failed Activity for rejected merges.
      if (needsClientFailureNotice(caught))
        activityInbox.notify({
          key: mergeKey,
          title: `Could not merge PR #${view.number}`,
          status: "failed",
          message: failureMessage(caught),
          scope,
        });
      return;
    }

    try {
      await applyMergedPr(view);
    } catch (caught) {
      postMergeFailure(
        `PR #${view.number} merged, but its status could not refresh`,
        caught,
      );
    }

    // Decided again after the merge: the worktrees may have changed meanwhile.
    const target = prCheckout(
      gitWorkspaceSnapshot(view.projectId)?.summaries ?? [],
      view.repo,
      core.headRefName,
    );
    let localUpdateQueued = false;
    if (followUp === "remove-worktree" && target?.kind === "linked") {
      activityInbox.notify({
        key: mergeKey,
        title: `Merged pull request #${view.number}`,
        status: "succeeded",
        scope,
      });
      localUpdateQueued = true;
      // Reports its own success or failure; uncommitted changes keep the worktree.
      await removeGitRepoWorktree(view.projectId, target.repo.relativePath, {
        force: false,
        deleteBranch: true,
      });
    } else if (
      followUp === "switch-base-and-pull" &&
      target?.kind === "primary"
    ) {
      try {
        await queueMergedPrFollowUp(
          {
            projectId: view.projectId,
            repo: target.repo.relativePath,
            number: view.number,
            baseBranch: core.baseRefName,
          },
          {
            start: startGitOperation,
            activities: activityInbox,
            notify: (title) =>
              activityInbox.notify({
                key: mergeKey,
                title,
                status: "succeeded",
                scope,
              }),
          },
        );
        localUpdateQueued = true;
      } catch (caught) {
        postMergeFailure(
          `PR #${view.number} merged, but the local branch update could not start`,
          caught,
        );
      }
    }

    if (!localUpdateQueued)
      activityInbox.notify({
        key: mergeKey,
        title: `Merged pull request #${view.number}`,
        status: "succeeded",
        scope,
      });
    invalidateGit(view.projectId);
    try {
      // Refreshes the shared snapshot and the pane's visible sections.
      await refreshPrPane(view.id);
    } catch (caught) {
      postMergeFailure(
        `PR #${view.number} merged, but Git state could not refresh`,
        caught,
      );
    }
  } finally {
    view.merging = false;
  }
}

function retrySection(
  section:
    | "core"
    | "conversation"
    | "overview"
    | "commits"
    | "checks"
    | "files",
): void {
  const view = activeCenterPrView;
  if (!view) return;
  if (section === "core") void loadPrCore(view, { force: true });
  else void loadPrSection(view, section, { force: true });
}

$effect(() => {
  setActivePrRefreshDemand(activeCenterPrView?.id);
  return () => setActivePrRefreshDemand(undefined);
});
</script>

<GitHubPrPane
  view={activeCenterPrView}
  {checkout}
  onCopyLink={() => void copyActivePrLink()}
  onRefresh={() =>
    activeCenterPrView && void refreshPrPane(activeCenterPrView.id)}
  onCheckout={() => void checkoutActivePr()}
  onOpenExternal={() => {
    const url =
      activeCenterPrView?.core.data?.url ?? activeCenterPrView?.summary?.url;
    if (url) window.open(url, "_blank", "noopener");
  }}
  onTabChange={(tab) =>
    activeCenterPrView && selectPrTab(activeCenterPrView.id, tab)}
  onSectionRetry={retrySection}
  fileDiff={activeFileDiff}
  diffLayout={fileViewerPreferences.diffLayout}
  onDiffLayoutChange={setDiffLayout}
  onFileSelect={(path) =>
    activeCenterPrView && selectPrFile(activeCenterPrView.id, path)}
  onFileDiffRetry={() =>
    activeCenterPrView && retrySelectedPrFile(activeCenterPrView.id)}
  onMergeMethodChange={(method) =>
    activeCenterPrView && selectPrMergeMethod(activeCenterPrView.id, method)}
  onMerge={(method, followUp) => void mergeActivePr(method, followUp)}
/>
