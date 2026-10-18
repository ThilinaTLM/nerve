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
} from "$lib/features/git/state/git-refresh-coordinator.svelte";
import { refreshPrs } from "$lib/features/git/state/git-panel-refresh.svelte";
import {
  gitCurrentBranch,
  gitSelectors,
} from "$lib/features/git/state/git-selectors.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  refreshPrPane,
  retrySelectedPrFile,
  selectPrFile,
  selectPrMergeMethod,
  selectPrTab,
} from "$lib/features/git/state/pr-tabs.svelte";
import {
  errorDetails,
  showCriticalError,
} from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import { observeGitOperationStart } from "$lib/features/git/state/git-operation-tracking";
import { queueMergedPrFollowUp } from "$lib/features/git/state/pr-merge-follow-up";

const activeCenterPrView = $derived(gitSelectors.activeCenterPrView);
const activeFileDiff = $derived(selectedPrFileDiffResource(activeCenterPrView));
const currentBranch = $derived(
  activeCenterPrView
    ? gitCurrentBranch(activeCenterPrView.projectId, activeCenterPrView.repo)
    : undefined,
);

async function copyActivePrLink() {
  const url =
    activeCenterPrView?.core.data?.url ?? activeCenterPrView?.summary?.url;
  if (!url) return;
  try {
    await writeClipboardText(url);
    notify.success(`Copied link to PR #${activeCenterPrView?.number}`);
  } catch {
    notify.error("Could not copy to clipboard");
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
    showCriticalError("Could not check out pull request", errorDetails(caught));
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
  view.mergeError = undefined;

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
      const message = errorDetails(caught);
      view.mergeError = message;
      showCriticalError("Could not merge pull request", message);
      return;
    }

    try {
      await applyMergedPr(view);
    } catch (caught) {
      showCriticalError(
        "Pull request merged, but its status could not refresh",
        errorDetails(caught),
      );
    }

    let localUpdateQueued = false;
    if (followUp === "switch-base-and-pull") {
      try {
        await queueMergedPrFollowUp(
          {
            projectId: view.projectId,
            repo: view.repo,
            number: view.number,
            baseBranch: core.baseRefName,
          },
          {
            start: startGitOperation,
            activities: activityInbox,
            notify: (message) => notify.success(message),
          },
        );
        localUpdateQueued = true;
      } catch (caught) {
        showCriticalError(
          "Pull request merged, but the local branch update could not start",
          errorDetails(caught),
        );
      }
    }

    if (!localUpdateQueued)
      notify.success(`Merged pull request #${view.number}`);
    invalidateGit(view.projectId);
    try {
      await Promise.all([
        refreshPrPane(view.id),
        refreshPrs(view.projectId, view.repo, true, true),
      ]);
    } catch (caught) {
      showCriticalError(
        "Pull request merged, but Git state could not refresh",
        errorDetails(caught),
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
  if (section === "core")
    void loadPrCore(view, {
      force: true,
      criticalErrorTitle: "Could not load pull request",
    });
  else
    void loadPrSection(view, section, {
      force: true,
      criticalErrorTitle: "Could not load pull request section",
    });
}

$effect(() => {
  setActivePrRefreshDemand(activeCenterPrView?.id);
  return () => setActivePrRefreshDemand(undefined);
});
</script>

<GitHubPrPane
  view={activeCenterPrView}
  {currentBranch}
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
  onFileSelect={(path) =>
    activeCenterPrView && selectPrFile(activeCenterPrView.id, path)}
  onFileDiffRetry={() =>
    activeCenterPrView && retrySelectedPrFile(activeCenterPrView.id)}
  onMergeMethodChange={(method) =>
    activeCenterPrView && selectPrMergeMethod(activeCenterPrView.id, method)}
  onMerge={(method, followUp) => void mergeActivePr(method, followUp)}
/>
