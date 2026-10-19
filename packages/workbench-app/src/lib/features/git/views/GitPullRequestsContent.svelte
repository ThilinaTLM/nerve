<script lang="ts">
import { onDestroy, untrack } from "svelte";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import { Separator } from "@nervekit/ui-kit/components/ui/separator";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import ExternalLink from "@lucide/svelte/icons/external-link";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestCreate from "@lucide/svelte/icons/git-pull-request-create";
import Link from "@lucide/svelte/icons/link";
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
import type { GitPrFilterConfig, GitPrQuickFilter } from "../pr-filters";
import {
  activeGitPrFilterCount,
  applyQuickGitPrFilter,
  hasActiveGitPrFilters,
  pinCurrentBranchPr,
  quickGitPrFilter,
} from "../pr-filters";

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

const pinning = $derived(pinCurrentBranchPr(displayedPrs, currentBranch));
const pinnedPr = $derived(pinning.pinned);
const listedPrs = $derived(pinning.ordered);
const quickFilter = $derived(quickGitPrFilter(filters));
const showQuickFilter = $derived(
  selectedRepoHasGithubRemote && Boolean(github?.authenticated),
);

// Repository URLs are not part of the repo summary, so they are derived from
// GitHub data already loaded: PR URLs (selected repo) or PR heads.
const selectedRepoKey = $derived(selectedRepoSummary?.relativePath);
function repoUrlOf(repo: GitRepoSummary): string | undefined {
  if (!repo.hasGithubRemote || !github?.authenticated) return undefined;
  const heads = model.repoBranchState(repo.relativePath).prHeads;
  if (heads?.repository) return `https://github.com/${heads.repository}`;
  const prUrl = repo.relativePath === selectedRepoKey ? prs[0]?.url : undefined;
  return prUrl?.match(/^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\//)?.[1];
}
// Load PR heads once per selected repository. Track only the repository key
// and sign-in state: refreshPrHeads reads and writes reactive loading state,
// so calling it tracked would re-run this effect in an endless refresh loop.
const prHeadsTarget = $derived(
  selectedRepoSummary?.hasGithubRemote && github?.authenticated
    ? selectedRepoSummary.relativePath
    : undefined,
);
$effect(() => {
  const repository = prHeadsTarget;
  if (repository) untrack(() => void actions.refreshPrHeads(repository));
});

/** Open PR number for a repo's current branch (filter-independent via heads). */
function branchPrNumber(repo: GitRepoSummary): number | undefined {
  if (!repo.currentBranch) return undefined;
  if (repo.relativePath === selectedRepoKey && pinnedPr) return pinnedPr.number;
  return model
    .repoBranchState(repo.relativePath)
    .prHeads?.prs.find((pr) => pr.headRefName === repo.currentBranch)?.number;
}

function compareUrl(repo: GitRepoSummary): string | undefined {
  const base = repoUrlOf(repo);
  if (!base || !repo.currentBranch || repo.onBaseBranch) return undefined;
  const ref = (name: string) =>
    name.split("/").map(encodeURIComponent).join("/");
  return `${base}/compare/${ref(repo.baseBranch)}...${ref(repo.currentBranch)}?expand=1`;
}

function openExternal(url: string | undefined) {
  if (url) window.open(url, "_blank", "noopener");
}

function copyUrl(url: string | undefined) {
  if (url) void navigator.clipboard?.writeText(url).catch(() => {});
}

let listEl: HTMLElement | undefined = $state();
let flashed = $state<number>();
let flashTimer: ReturnType<typeof setTimeout> | undefined;
onDestroy(() => clearTimeout(flashTimer));

function showPinned(number: number) {
  if (pinnedPr?.number !== number) {
    onOpenPr(number);
    return;
  }
  listEl
    ?.querySelector("[data-pinned-pr]")
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  flashed = number;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flashed = undefined), 1500);
}

function selectQuickFilter(value: string) {
  if (!value) return;
  void actions.configurePullRequests(
    model.selectedRepository,
    applyQuickGitPrFilter(filters, value as GitPrQuickFilter),
  );
}

function toggleChecks(pr: GithubPr) {
  expandedPr = expandedPr === pr.number ? undefined : pr.number;
  onExpandedPrChange?.(expandedPr);
}
</script>

{#snippet note(text: string)}
  <p class="py-1 text-xs text-muted-foreground">{text}</p>
{/snippet}

{#snippet branchActions(repo: GitRepoSummary)}
  {@const number = repo.hasGithubRemote ? branchPrNumber(repo) : undefined}
  {#if number !== undefined}
    <Button
      variant="ghost"
      size="sm"
      title={`Show pull request #${number}`}
      onclick={() => showPinned(number)}
      ><GitPullRequest aria-hidden="true" />#{number}</Button
    >
  {/if}
{/snippet}

{#snippet contextItems(repo: GitRepoSummary)}
  {@const url = repoUrlOf(repo)}
  {@const compare = compareUrl(repo)}
  <ContextMenu.Item disabled={!url} onclick={() => openExternal(url)}
    ><ExternalLink />Open repository on GitHub</ContextMenu.Item
  >
  <ContextMenu.Item disabled={!compare} onclick={() => openExternal(compare)}
    ><GitPullRequestCreate />Create pull request{repo.currentBranch
      ? ` for ${repo.currentBranch}`
      : ""}</ContextMenu.Item
  >
  <ContextMenu.Item disabled={!url} onclick={() => copyUrl(url)}
    ><Link />Copy repository URL</ContextMenu.Item
  >
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

  <GitRepoSwitcher {model} {actions} {contextItems} {branchActions} />

  <Separator class="my-1.5" />

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
  {:else}
    {@render quickFilterGroup()}
    {#if loadingPrs && prs.length === 0}
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
      {@render prList()}
    {/if}
  {/if}
</div>

{#snippet quickFilterGroup()}
  {#if showQuickFilter}
    <div class="flex shrink-0 pt-1 pb-1.5">
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="chip"
        spacing={1}
        aria-label="Quick filter"
        value={quickFilter ?? ""}
        onValueChange={selectQuickFilter}
      >
        <ToggleGroup.Item value="all">All</ToggleGroup.Item>
        <ToggleGroup.Item value="mine">Mine</ToggleGroup.Item>
        <ToggleGroup.Item
          value="review"
          title="Pull requests where your review is requested"
          >To review</ToggleGroup.Item
        >
      </ToggleGroup.Root>
    </div>
  {/if}
{/snippet}

{#snippet prList()}
  <div class="flex min-h-0 flex-1 flex-col" bind:this={listEl}>
    <ScrollRegion ariaLabel="Pull requests" contentClass="min-w-0">
      {#if prs.length > displayedPrs.length}
        {@render note(`Showing ${displayedPrs.length} of ${prs.length}`)}
      {/if}
      <PanelList ariaLabel="Pull requests" class="gap-1.5 py-0.5">
        {#each listedPrs as pr (pr.number)}
          <div
            data-pinned-pr={pr === pinnedPr ? "" : undefined}
            class={[
              "relative rounded-md",
              flashed === pr.number &&
                "after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-2 after:ring-inset after:ring-ring/60",
            ]}
          >
            <GitPullRequestRow
              {pr}
              expanded={expandedPr === pr.number}
              checkedOut={pr === pinnedPr}
              disabled={!capabilities.openPullRequest.enabled}
              disabledReason={capabilities.openPullRequest.enabled
                ? undefined
                : capabilities.openPullRequest.reason}
              onOpen={() => onOpenPr(pr.number)}
              onToggleChecks={() => toggleChecks(pr)}
            />
          </div>
        {/each}
      </PanelList>
    </ScrollRegion>
  </div>
{/snippet}
