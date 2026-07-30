<script lang="ts">
import ListFilter from "@lucide/svelte/icons/list-filter";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type {
  GithubPr,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import {
  PanelHeader,
  PanelList,
  PanelToolbarButton,
} from "$lib/presentation/panel";
import GitPullRequestRow from "./GitPullRequestRow.svelte";
import GitPullRequestRowSkeleton from "./GitPullRequestRowSkeleton.svelte";
import GitRepositorySelector from "./GitRepositorySelector.svelte";
import type {
  GitPanelCapabilities,
  GitPrFilterConfig,
} from "./git-panel-types";
import {
  activeGitPrFilterCount,
  hasActiveGitPrFilters,
} from "./git-panel-controller.js";

type Props = {
  displayedPrs: GithubPr[];
  prs: GithubPr[];
  filters: GitPrFilterConfig;
  repositories: GitRepoSummary[];
  selectedRepository: string;
  selectedRepoSummary?: GitRepoSummary;
  github?: GithubStatusResponse;
  selectedRepoHasGithubRemote: boolean;
  loadingPrs: boolean;
  capabilities: GitPanelCapabilities;
  expandedPr?: number;
  onExpandedPrChange?: (number: number | undefined) => void;
  onRefreshPrs: () => void;
  onSelectRepo: (repository: string) => void;
  onOpenFilters: () => void;
  onOpenPr: (prNumber: number) => void;
};

let {
  displayedPrs,
  prs,
  filters,
  repositories,
  selectedRepository,
  selectedRepoSummary,
  github,
  selectedRepoHasGithubRemote,
  loadingPrs,
  capabilities,
  expandedPr = $bindable(undefined),
  onExpandedPrChange,
  onRefreshPrs,
  onSelectRepo,
  onOpenFilters,
  onOpenPr,
}: Props = $props();

const activeFilterCount = $derived(activeGitPrFilterCount(filters));

function toggleChecks(pr: GithubPr) {
  expandedPr = expandedPr === pr.number ? undefined : pr.number;
  onExpandedPrChange?.(expandedPr);
}
</script>

{#snippet note(text: string)}
  <p class="py-1 text-xs text-muted-foreground">{text}</p>
{/snippet}

{#snippet headerActions()}
  {#if selectedRepoHasGithubRemote && github?.authenticated}
    <PanelToolbarButton
      icon={ListFilter}
      label={activeFilterCount > 0
        ? `Configure pull request filters · ${activeFilterCount} active`
        : "Configure pull request filters"}
      title={activeFilterCount > 0
        ? `${activeFilterCount} active ${activeFilterCount === 1 ? "filter" : "filters"}`
        : "Configure filters and sorting"}
      active={activeFilterCount > 0}
      onclick={onOpenFilters}
    />
    <PanelToolbarButton
      icon={RefreshCw}
      label="Refresh PRs"
      title={`Refresh PRs · signed in as ${github.login ?? "unknown"}`}
      loading={loadingPrs}
      disabled={!capabilities.refresh.enabled || loadingPrs}
      onclick={onRefreshPrs}
    />
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
  <PanelHeader
    title="Pull requests"
    count={displayedPrs.length > 0 ? displayedPrs.length : undefined}
    trailing={headerActions}
  />

  {#if repositories.length > 1}
    <div class="shrink-0 py-1.5">
      <GitRepositorySelector
        repos={repositories}
        selectedRepo={selectedRepository}
        selectCapability={capabilities.selectRepository}
        {onSelectRepo}
      />
    </div>
  {/if}

  {#if selectedRepoSummary && !selectedRepoSummary.hasRemote}
    {@render note("No remote configured for this repository.")}
  {:else if selectedRepoSummary && !selectedRepoSummary.hasGithubRemote}
    {@render note("PRs are only available for GitHub remotes.")}
  {:else if !github}
    <PanelList ariaLabel="Loading pull requests" class="gap-1.5 py-0.5">
      <GitPullRequestRowSkeleton />
    </PanelList>
  {:else if !github.available}
    {@render note(github.reason ?? "GitHub CLI (gh) is not installed.")}
  {:else if !github.authenticated}
    {@render note("Not authenticated. Run `gh auth login`.")}
  {:else if loadingPrs && prs.length === 0}
    <PanelList ariaLabel="Loading pull requests" class="gap-1.5 py-0.5">
      <GitPullRequestRowSkeleton />
    </PanelList>
  {:else if displayedPrs.length === 0}
    {@render note(
      hasActiveGitPrFilters(filters)
        ? "No pull requests match these filters."
        : "No open PRs for this repository.",
    )}
  {:else}
    <ScrollArea class="min-h-0 flex-1" viewportClass="min-w-0">
      {#if prs.length > displayedPrs.length}
        {@render note(`Showing ${displayedPrs.length} of ${prs.length}`)}
      {/if}
      <PanelList ariaLabel="Pull requests" class="gap-1.5 py-0.5">
        {#each displayedPrs as pr (pr.number)}
          <GitPullRequestRow
            {pr}
            expanded={expandedPr === pr.number}
            disabled={!capabilities.openPullRequest.enabled}
            disabledReason={capabilities.openPullRequest.enabled
              ? undefined
              : capabilities.openPullRequest.reason}
            onOpen={() => onOpenPr(pr.number)}
            onToggleChecks={() => toggleChecks(pr)}
          />
        {/each}
      </PanelList>
    </ScrollArea>
  {/if}
</div>
