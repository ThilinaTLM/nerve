<script lang="ts">
import { PanelView } from "@nervekit/workbench-ui/panel";
import GitPanelBanner from "./GitPanelBanner.svelte";
import GitPrFilterDialog from "./GitPrFilterDialog.svelte";
import GitPullRequestsContent from "./GitPullRequestsContent.svelte";
import { limitPullRequests } from "./git-panel-controller.js";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";

let {
  model,
  actions,
}: {
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

let prFilterDialogOpen = $state(false);
let expandedPr = $state<number | undefined>(undefined);

const displayedPullRequests = $derived(limitPullRequests(model.pullRequests));
const currentBranchName = $derived(
  model.repositorySummary?.currentBranch ?? null,
);
const selectedRepoHasGithubRemote = $derived(
  Boolean(
    model.repositorySummary?.hasRemote &&
    model.repositorySummary.hasGithubRemote,
  ),
);

function selectExpandedPullRequest(number: number | undefined): void {
  expandedPr = number;
  void actions.selectPullRequest(number);
}

function selectRepository(repository: string): void {
  if (repository === model.selectedRepository) return;
  expandedPr = undefined;
  void actions.selectRepository(repository);
}
</script>

<PanelView padded={false} scroll={false}>
  {#snippet banner()}<GitPanelBanner {model} />{/snippet}

  {#if model.availability.available && model.repositories.length > 0}
    <GitPullRequestsContent
      displayedPrs={displayedPullRequests}
      prs={[...model.pullRequests]}
      filters={model.pullRequestFilters}
      repositories={[...model.repositories]}
      selectedRepository={model.selectedRepository}
      selectedRepoSummary={model.repositorySummary}
      github={model.github}
      {selectedRepoHasGithubRemote}
      loadingPrs={model.loadingPullRequests}
      capabilities={model.capabilities}
      {expandedPr}
      onExpandedPrChange={selectExpandedPullRequest}
      onRefreshPrs={() =>
        void actions.refreshPullRequests(model.selectedRepository)}
      onSelectRepo={selectRepository}
      onOpenFilters={() => (prFilterDialogOpen = true)}
      onOpenPr={(number) =>
        void actions.openPullRequest(model.selectedRepository, number)}
    />
  {/if}
</PanelView>

<GitPrFilterDialog
  bind:open={prFilterDialogOpen}
  filters={model.pullRequestFilters}
  hasCurrentBranch={currentBranchName !== null}
  onApply={(filters) =>
    void actions.configurePullRequests(model.selectedRepository, filters)}
  onReset={() => void actions.resetPullRequestConfig(model.selectedRepository)}
/>
