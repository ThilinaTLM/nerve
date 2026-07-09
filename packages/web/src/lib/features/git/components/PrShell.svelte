<script lang="ts">
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

  import { checkoutGithubPr } from "$lib/api";
  import PrPane from "@nervekit/shared-ui/git/GithubPrPane.svelte";
  import { gitSelectors } from "$lib/features/git/state/git-selectors.svelte";
  import { invalidateGit } from "$lib/features/git/state/git-context.svelte";
  import { refreshPrPane } from "$lib/features/git/state/pr-tabs.svelte";

  const activeCenterPrView = $derived(gitSelectors.activeCenterPrView);

  async function checkoutActivePr() {
    const view = activeCenterPrView;
    if (!view) return;
    try {
      await checkoutGithubPr(view.projectId, view.repo, view.number);
      invalidateGit(view.projectId);
      void refreshPrPane(view.id);
    } catch (caught) {
      workspaceState.error = caught instanceof Error ? caught.message : String(caught);
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
