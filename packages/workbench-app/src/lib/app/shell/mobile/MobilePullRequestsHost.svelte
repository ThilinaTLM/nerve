<script lang="ts">
import ListFilter from "@lucide/svelte/icons/list-filter";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { MobileScreen } from "$lib/presentation/shell";
import {
  activeGitPrFilterCount,
  type GitPanelActions,
  type GitPanelModel,
} from "$lib/features/git";
import MobilePullRequestsBody from "./MobilePullRequestsBody.svelte";
import { backFromMobileScreen } from "./mobile-shell.svelte";

/** Standalone pull request list (from project home) around the shared body. */
let {
  model,
  actions: gitActions,
}: { model: GitPanelModel; actions: GitPanelActions } = $props();

const repository = $derived(model.selectedRepository);
const filterCount = $derived(activeGitPrFilterCount(model.pullRequestFilters));
let filtersOpen = $state(false);
</script>

<MobileScreen
  title="Pull requests"
  subtitle={model.repositorySummary?.name}
  onBack={backFromMobileScreen}
  backLabel="Back"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size={filterCount ? "default" : "icon"}
      ariaLabel={filterCount
        ? `Pull request filters, ${filterCount} active`
        : "Pull request filters"}
      onclick={() => (filtersOpen = true)}
    >
      <ListFilter size={17} strokeWidth={1.9} />
      {#if filterCount}<Badge variant="info">{filterCount}</Badge>{/if}
    </Button>
    <Button
      variant="ghost"
      size="icon"
      ariaLabel="Refresh pull requests"
      disabled={model.loadingPullRequests}
      onclick={() => void gitActions.refreshPullRequests(repository)}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
  {/snippet}

  <MobilePullRequestsBody {model} actions={gitActions} bind:filtersOpen />
</MobileScreen>
