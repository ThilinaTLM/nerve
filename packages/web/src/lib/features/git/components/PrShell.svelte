<script lang="ts">
  import { checkoutGithubPr } from "$lib/api";
  import PrPane from "$lib/features/git/components/PrPane.svelte";
  import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
  import {
    invalidateGit,
    refreshPrPane,
    workbenchState,
  } from "$lib/stores/workbench.svelte";

  const activeCenterPrView = $derived(gitSelectors.activeCenterPrView);

  async function checkoutActivePr() {
    const view = activeCenterPrView;
    if (!view) return;
    try {
      await checkoutGithubPr(view.projectId, view.repo, view.number);
      invalidateGit(view.projectId);
      void refreshPrPane(view.id);
    } catch (caught) {
      workbenchState.error = caught instanceof Error ? caught.message : String(caught);
    }
  }
</script>

<PrPane
  view={activeCenterPrView}
  onRefresh={() => activeCenterPrView && void refreshPrPane(activeCenterPrView.id)}
  onCheckout={() => void checkoutActivePr()}
  onOpenExternal={() =>
    activeCenterPrView?.detail &&
    window.open(activeCenterPrView.detail.url, "_blank", "noopener")}
/>
