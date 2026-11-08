<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { GithubMark } from "@nervekit/ui-kit/components/composites/github-mark";
import ScrollRegion from "@nervekit/ui-kit/components/composites/scroll-region";
import { SearchInput } from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import ListFilter from "@lucide/svelte/icons/list-filter";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import {
  PanelHeader,
  PanelList,
  PanelToolbarButton,
} from "$lib/presentation/panels";
import GitPullRequestRow from "./GitPullRequestRow.svelte";
import GitPullRequestRowSkeleton from "./GitPullRequestRowSkeleton.svelte";
import type { GitPanelActions, GitPanelModel } from "./git-panel-types";
import {
  activeGitPrFilterCount,
  availableGitPrLabels,
  groupGitPrsByRepository,
  type GitPrFilterConfig,
  type GitPrQuickFilter,
} from "../pr-filters";
import { prPanelSearch } from "../state/pr-panel-state.svelte";

type Props = {
  model: GitPanelModel;
  actions: GitPanelActions;
  expandedPr?: number;
  onExpandedPrChange?: (number: number | undefined) => void;
};

let {
  model,
  actions,
  expandedPr = $bindable(undefined),
  onExpandedPrChange,
}: Props = $props();

const overview = $derived(model.pullRequestsOverview);
const filters = $derived(model.pullRequestFilters);
const quick = $derived(model.pullRequestQuickFilter);
const activeFilterCount = $derived(activeGitPrFilterCount(filters));
const groups = $derived(
  groupGitPrsByRepository(overview.sources, {
    query: prPanelSearch.query,
    quick,
    filters,
  }),
);
const matchCount = $derived(
  groups.reduce((sum, group) => sum + group.prs.length, 0),
);
const labels = $derived(availableGitPrLabels(overview.sources));
const truncated = $derived(
  new Set(
    overview.sources.filter((source) => source.truncated).map((s) => s.key),
  ),
);
const hasOpenPrs = $derived(
  overview.sources.some((source) =>
    source.prs.some((pr) => pr.state === "OPEN"),
  ),
);
const refreshing = $derived(overview.loading || overview.refreshing);
const canRefresh = $derived(
  model.capabilities.refresh.enabled &&
    !refreshing &&
    overview.sources.length > 0,
);

const draftOptions = [
  ["include", "Include drafts"],
  ["exclude", "Exclude drafts"],
  ["only", "Only drafts"],
] as const;
const sortOptions = [
  ["updated-desc", "Recently updated"],
  ["updated-asc", "Least recently updated"],
] as const;

function configure(patch: Partial<GitPrFilterConfig>) {
  void actions.configurePullRequests({ ...filters, ...patch });
}

function toggleLabel(label: string, checked: boolean) {
  configure({
    labels: checked
      ? [...filters.labels, label]
      : filters.labels.filter((item) => item !== label),
  });
}

// Selected labels stay listed even after their last PR disappears.
const menuLabels = $derived(
  [...new Set([...labels, ...filters.labels])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  ),
);

function refresh() {
  for (const source of overview.sources)
    void actions.refreshPullRequests(source.repository);
}

function selectQuick(value: string) {
  if (value) void actions.setPullRequestQuickFilter(value as GitPrQuickFilter);
}

function toggleChecks(number: number) {
  expandedPr = expandedPr === number ? undefined : number;
  onExpandedPrChange?.(expandedPr);
}
</script>

{#snippet note(text: string)}
  <p class="py-1 text-ui text-muted-foreground">{text}</p>
{/snippet}

{#snippet skeletons()}
  <PanelList ariaLabel="Loading pull requests" class="gap-1.5 py-0.5">
    <GitPullRequestRowSkeleton />
    <GitPullRequestRowSkeleton />
    <GitPullRequestRowSkeleton />
  </PanelList>
{/snippet}

{#snippet headerActions()}
  {#if overview.status === "ready"}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon-sm"
            aria-label={activeFilterCount > 0
              ? `Pull request filters · ${activeFilterCount} active`
              : "Pull request filters"}
            title={activeFilterCount > 0
              ? `${activeFilterCount} active ${activeFilterCount === 1 ? "filter" : "filters"}`
              : "Filters and sorting"}
            active={activeFilterCount > 0}
          >
            <ListFilter aria-hidden="true" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-48">
        <div class="px-2 py-1 text-ui text-muted-foreground">Drafts</div>
        {#each draftOptions as [value, text] (value)}
          <DropdownMenu.CheckboxItem
            checked={filters.drafts === value}
            onCheckedChange={() => configure({ drafts: value })}
            >{text}</DropdownMenu.CheckboxItem
          >
        {/each}
        {#if menuLabels.length > 0}
          <DropdownMenu.Separator />
          <div class="px-2 py-1 text-ui text-muted-foreground">Labels</div>
          {#each menuLabels as label (label)}
            <DropdownMenu.CheckboxItem
              checked={filters.labels.includes(label)}
              closeOnSelect={false}
              onCheckedChange={(checked) => toggleLabel(label, checked)}
              >{label}</DropdownMenu.CheckboxItem
            >
          {/each}
        {/if}
        <DropdownMenu.Separator />
        <div class="px-2 py-1 text-ui text-muted-foreground">Sort</div>
        {#each sortOptions as [value, text] (value)}
          <DropdownMenu.CheckboxItem
            checked={filters.sort === value}
            onCheckedChange={() => configure({ sort: value })}
            >{text}</DropdownMenu.CheckboxItem
          >
        {/each}
        {#if activeFilterCount > 0}
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onclick={() => void actions.resetPullRequestConfig()}
            ><RotateCcw aria-hidden="true" />Reset filters</DropdownMenu.Item
          >
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <PanelToolbarButton
      icon={RefreshCw}
      label={refreshing ? "Refreshing pull requests" : "Refresh PRs"}
      title={overview.viewer
        ? `Refresh PRs · signed in as ${overview.viewer}`
        : "Refresh PRs"}
      loading={refreshing}
      loadingVariant="refresh"
      disabled={!canRefresh}
      onclick={refresh}
    />
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
  <PanelHeader
    title="Pull requests"
    count={overview.status === "ready" && matchCount > 0
      ? matchCount
      : undefined}
    trailing={headerActions}
  />

  {#if overview.notice}
    <Callout layout="strip" tone="destructive" icon={TriangleAlert}>
      {overview.notice}
      {#snippet actions()}
        <PanelToolbarButton
          icon={RotateCcw}
          label="Retry refreshing pull requests"
          dense
          disabled={!canRefresh}
          onclick={refresh}
        />
      {/snippet}
    </Callout>
  {/if}

  {#if overview.repositoryCount === 0}
    {@render note("No GitHub repositories in this project.")}
  {:else if overview.status === "unavailable"}
    {@render note("GitHub CLI (gh) is not installed.")}
  {:else if overview.status === "unauthenticated"}
    {@render note("Not authenticated. Run `gh auth login`.")}
  {:else if overview.status === "loading"}
    {@render skeletons()}
  {:else}
    <div class="flex shrink-0 flex-col gap-1.5 pt-1">
      <SearchInput
        bind:value={prPanelSearch.query}
        placeholder="Search repo, title, #number, author"
        ariaLabel="Search pull requests"
      />
      <ToggleGroup.Root
        type="single"
        size="sm"
        variant="chip"
        spacing={1}
        aria-label="Quick filter"
        value={quick}
        onValueChange={selectQuick}
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
    <div class="mt-1.5 flex min-h-0 flex-1 flex-col border-t">
      <ScrollRegion
        ariaLabel="Pull requests"
        surface="panel"
        class="-mx-2"
        contentClass="min-w-0 px-2"
      >
        {#each groups as group (group.key)}
          <div
            class="sticky top-0 z-10 flex items-center gap-1.5 bg-panel pt-2 pb-1 text-caption text-muted-foreground"
          >
            <GithubMark class="size-3" />
            <span class="truncate font-medium text-foreground"
              >{group.name}</span
            >
            <span class="tabular-nums">{group.prs.length}</span>
          </div>
          <PanelList
            ariaLabel={`${group.name} pull requests`}
            class="gap-1.5 py-1.5"
          >
            {#each group.prs as pr (pr.number)}
              <GitPullRequestRow
                {pr}
                expanded={expandedPr === pr.number}
                checkedOut={pr.checkedOut}
                disabled={!model.capabilities.openPullRequest.enabled}
                disabledReason={model.capabilities.openPullRequest.enabled
                  ? undefined
                  : model.capabilities.openPullRequest.reason}
                onOpen={() =>
                  void actions.openPullRequest(group.repository, pr.number)}
                onToggleChecks={() => toggleChecks(pr.number)}
              />
            {/each}
          </PanelList>
          {#if truncated.has(group.key)}
            {@render note(
              "More open pull requests exist than are listed here. Open the repository on GitHub for the rest.",
            )}
          {/if}
        {:else}
          {@render note(
            hasOpenPrs ? "No pull requests match." : "No open pull requests.",
          )}
        {/each}
      </ScrollRegion>
    </div>
  {/if}
</div>
