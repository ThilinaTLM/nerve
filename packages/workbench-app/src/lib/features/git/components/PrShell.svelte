<script lang="ts">
import type { GithubPrMergeMethod } from "@nervekit/contracts";
import { checkoutGithubPr, mergeGithubPr } from "$lib/api";
import { GithubPrPane } from "$lib/presentation/git";
import { isGithubChecksPending } from "$lib/features/git/checks";
import { invalidateGit } from "$lib/features/git/state/git-context.svelte";
import { refreshPrs } from "$lib/features/git/state/git-panel-refresh.svelte";
import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
import {
  loadPrFiles,
  refreshPrPane,
  selectPrFile,
  selectPrMergeMethod,
  selectPrTab,
} from "$lib/features/git/state/pr-tabs.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";

const PR_CHECKS_POLL_MS = 10_000;
const activeCenterPrView = $derived(gitSelectors.activeCenterPrView);

async function checkoutActivePr() {
  const view = activeCenterPrView;
  if (!view) return;
  try {
    await checkoutGithubPr(view.projectId, view.repo, view.number);
    invalidateGit(view.projectId);
    void refreshPrPane(view.id);
  } catch (caught) {
    notify.error("Could not check out pull request", {
      description: caught instanceof Error ? caught.message : String(caught),
    });
  }
}

async function mergeActivePr(method: GithubPrMergeMethod) {
  const view = activeCenterPrView;
  const detail = view?.detail;
  if (!view || !detail || view.merging) return;
  view.merging = true;
  view.mergeError = undefined;
  try {
    await mergeGithubPr(
      view.projectId,
      view.repo,
      view.number,
      method,
      detail.headRefOid,
    );
    notify.success(`Merged pull request #${view.number}`);
    invalidateGit(view.projectId);
    await Promise.all([
      refreshPrPane(view.id),
      refreshPrs(view.projectId, view.repo, true, true),
    ]);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.mergeError = message;
    notify.error("Could not merge pull request", { description: message });
    void refreshPrPane(view.id);
  } finally {
    view.merging = false;
  }
}

$effect(() => {
  const view = activeCenterPrView;
  if (!view || !isGithubChecksPending(view.detail?.checks)) return;

  const refresh = () => {
    if (document.visibilityState === "visible") void refreshPrPane(view.id);
  };
  const intervalId = window.setInterval(refresh, PR_CHECKS_POLL_MS);
  return () => window.clearInterval(intervalId);
});
</script>

<GithubPrPane
  view={activeCenterPrView}
  onRefresh={() =>
    activeCenterPrView && void refreshPrPane(activeCenterPrView.id)}
  onCheckout={() => void checkoutActivePr()}
  onOpenExternal={() =>
    activeCenterPrView?.detail &&
    window.open(activeCenterPrView.detail.url, "_blank", "noopener")}
  onTabChange={(tab) =>
    activeCenterPrView && selectPrTab(activeCenterPrView.id, tab)}
  onFilesRetry={() =>
    activeCenterPrView && void loadPrFiles(activeCenterPrView.id, true)}
  onFileSelect={(path) =>
    activeCenterPrView && selectPrFile(activeCenterPrView.id, path)}
  onMergeMethodChange={(method) =>
    activeCenterPrView && selectPrMergeMethod(activeCenterPrView.id, method)}
  onMerge={(method) => void mergeActivePr(method)}
/>
