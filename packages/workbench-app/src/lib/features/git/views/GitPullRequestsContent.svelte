<script lang="ts">
import ListFilter from "@lucide/svelte/icons/list-filter";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  GithubPr,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import {
  PanelBanner,
  PanelHeader,
  PanelList,
  PanelScrollRegion,
  PanelToolbarButton,
} from "$lib/presentation/panels";
import GitPullRequestRow from "./GitPullRequestRow.svelte";
import GitPullRequestRowSkeleton from "./GitPullRequestRowSkeleton.svelte";
import GitRepoSwitcher from "./GitRepoSwitcher.svelte";
import type {
  GitPanelActions,
  GitPanelCapabilities,
  GitPanelModel,
} from "./git-panel-types";
import type { GitPrFilterConfig } from "../pr-filters";
import { activeGitPrFilterCount, hasActiveGitPrFilters } from "../pr-filters";

type Props = {
  model: GitPanelModel;
  actions: GitPanelActions;
  displayedPrs: GithubPr[];
  prs: GithubPr[];
  filters: GitPrFilterConfig;
  selectedRepoSummary?: GitRepoSummary;
  github?: GithubStatusResponse;
  selectedRepoHasGithubRemote: boolean;
  loadingPrs: boolean;
  refreshError?: string;
  capabilities: GitPanelCapabilities;
  expandedPr?: number;
  onExpandedPrChange?: (number: number | undefined) => void;
  onRefreshPrs: () => void;
  onOpenFilters: () => void;
  onOpenPr: (prNumber: number) => void;
};

let {
  model,
  actions,
  displayedPrs,
  prs,
  filters,
  selectedRepoSummary,
  github,
  selectedRepoHasGithubRemote,
  loadingPrs,
  refreshError,
  capabilities,
  expandedPr = $bindable(undefined),
  onExpandedPrChange,
  onRefreshPrs,
  onOpenFilters,
  onOpenPr,
}: Props = $props();

const activeFilterCount = $derived(activeGitPrFilterCount(filters));
const currentBranch = $derived(selectedRepoSummary?.currentBranch ?? undefined);

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
      label={loadingPrs ? "Refreshing pull requests" : "Refresh PRs"}
      title={`Refresh PRs · signed in as ${github.login ?? "unknown"}`}
      loading={loadingPrs}
      loadingVariant="refresh"
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

  <!-- The Git tab gets this breathing room from its remote-action toolbar; the
       PR list follows the switcher directly, so it adds the gap itself. -->
  <div class="shrink-0 pb-1">
    <GitRepoSwitcher {model} {actions} />
  </div>

  {#if refreshError}
    <PanelBanner tone="destructive" icon={TriangleAlert}>
      Could not refresh PRs: {refreshError}
      {#snippet actions()}
        <PanelToolbarButton
          icon={RotateCcw}
          label="Retry refreshing pull requests"
          dense
          disabled={loadingPrs}
          onclick={onRefreshPrs}
        />
      {/snippet}
    </PanelBanner>
  {/if}

  {#if selectedRepoSummary && !selectedRepoSummary.hasRemote}
    {@render note("No remote configured for this repository.")}
  {:else if selectedRepoSummary && !selectedRepoSummary.hasGithubRemote}
    {@render note("PRs are only available for GitHub remotes.")}
  {:else if !github}
    <PanelList ariaLabel="Loading pull requests" class="gap-1.5 py-0.5">
      <GitPullRequestRowSkeleton />
      <GitPullRequestRowSkeleton />
      <GitPullRequestRowSkeleton />
    </PanelList>
  {:else if !github.available}
    {@render note(github.reason ?? "GitHub CLI (gh) is not installed.")}
  {:else if !github.authenticated}
    {@render note("Not authenticated. Run `gh auth login`.")}
  {:else if loadingPrs && prs.length === 0}
    <PanelList ariaLabel="Loading pull requests" class="gap-1.5 py-0.5">
      <GitPullRequestRowSkeleton />
      <GitPullRequestRowSkeleton />
      <GitPullRequestRowSkeleton />
    </PanelList>
  {:else if displayedPrs.length === 0}
    {@render note(
      hasActiveGitPrFilters(filters)
        ? "No pull requests match these filters."
        : "No open PRs for this repository.",
    )}
  {:else}
    <PanelScrollRegion ariaLabel="Pull requests" contentClass="min-w-0">
      {#if prs.length > displayedPrs.length}
        {@render note(`Showing ${displayedPrs.length} of ${prs.length}`)}
      {/if}
      <PanelList ariaLabel="Pull requests" class="gap-1.5 py-0.5">
        {#each displayedPrs as pr (pr.number)}
          <GitPullRequestRow
            {pr}
            expanded={expandedPr === pr.number}
            checkedOut={pr.headRefName === currentBranch}
            disabled={!capabilities.openPullRequest.enabled}
            disabledReason={capabilities.openPullRequest.enabled
              ? undefined
              : capabilities.openPullRequest.reason}
            onOpen={() => onOpenPr(pr.number)}
            onToggleChecks={() => toggleChecks(pr)}
          />
        {/each}
      </PanelList>
    </PanelScrollRegion>
  {/if}
</div>
