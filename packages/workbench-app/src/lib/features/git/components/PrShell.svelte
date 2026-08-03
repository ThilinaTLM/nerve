<script lang="ts">
import type { GithubPrMergeMethod } from "@nervekit/contracts";
import { checkoutGithubPr, mergeGithubPr } from "$lib/api";
import { GithubPrPane } from "$lib/presentation/git";
import { invalidateGit } from "$lib/features/git/state/git-context.svelte";
import {
  applyMergedPr,
  loadPrCore,
  loadPrSection,
  selectedPrFileDiffResource,
  setActivePrRefreshDemand,
} from "$lib/features/git/state/git-refresh-coordinator.svelte";
import { refreshPrs } from "$lib/features/git/state/git-panel-refresh.svelte";
import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
import {
  refreshPrPane,
  retrySelectedPrFile,
  selectPrFile,
  selectPrMergeMethod,
  selectPrTab,
} from "$lib/features/git/state/pr-tabs.svelte";
import { notify } from "$lib/features/notifications/notify.svelte";

const activeCenterPrView = $derived(gitSelectors.activeCenterPrView);
const activeFileDiff = $derived(selectedPrFileDiffResource(activeCenterPrView));

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
  const core = view?.core.data;
  if (!view || !core || view.merging) return;
  view.merging = true;
  view.mergeError = undefined;
  try {
    await mergeGithubPr(
      view.projectId,
      view.repo,
      view.number,
      method,
      core.headRefOid,
    );
    await applyMergedPr(view);
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

<GithubPrPane
  view={activeCenterPrView}
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
  onMerge={(method) => void mergeActivePr(method)}
/>
