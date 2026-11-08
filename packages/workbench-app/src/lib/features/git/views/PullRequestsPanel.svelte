<script lang="ts">
import { PanelView } from "$lib/presentation/panels";
import GitPanelBanner from "./GitPanelBanner.svelte";
import GitPullRequestsContent from "./GitPullRequestsContent.svelte";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";

let {
  model,
  actions,
}: {
  model: GitPanelModel;
  actions: GitPanelActions;
} = $props();

let expandedPr = $state<number | undefined>(undefined);

function selectExpandedPullRequest(number: number | undefined): void {
  expandedPr = number;
  void actions.selectPullRequest(number);
}
</script>

<PanelView>
  {#snippet banner()}<GitPanelBanner {model} />{/snippet}

  {#if model.availability.available && model.repositories.length > 0}
    <GitPullRequestsContent
      {model}
      {actions}
      {expandedPr}
      onExpandedPrChange={selectExpandedPullRequest}
    />
  {/if}
</PanelView>
