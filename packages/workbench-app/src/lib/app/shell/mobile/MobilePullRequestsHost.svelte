<script lang="ts">
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import ListFilter from "@lucide/svelte/icons/list-filter";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GithubPr } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import SwitchField from "@nervekit/ui-kit/components/composites/switch-field";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  activeGitPrFilterCount,
  applyGitPrFilterDraft,
  createGitPrFilterDraft,
  defaultGitPrFilterConfig,
  gitPrFilterConfigsEqual,
  type GitPanelActions,
  type GitPanelModel,
  type GitPrFilterDraft,
} from "$lib/features/git";
import { openMobileCenter } from "./mobile-route-activation.svelte";
import { backFromMobileScreen } from "./mobile-shell.svelte";

/** Open pull requests for the selected repository; each opens its review. */
let {
  model,
  actions: gitActions,
}: { model: GitPanelModel; actions: GitPanelActions } = $props();

const repository = $derived(model.selectedRepository);
const filterCount = $derived(activeGitPrFilterCount(model.pullRequestFilters));
const hasCurrentBranch = $derived(
  Boolean(model.repositorySummary?.currentBranch),
);

let filtersOpen = $state(false);
let draft = $state<GitPrFilterDraft>(
  createGitPrFilterDraft(defaultGitPrFilterConfig),
);
const draftFilters = $derived(applyGitPrFilterDraft(draft, hasCurrentBranch));
const canApply = $derived(
  (draft.author !== "username" || draft.username.trim().length > 0) &&
    !gitPrFilterConfigsEqual(draftFilters, model.pullRequestFilters),
);
const canReset = $derived(
  !gitPrFilterConfigsEqual(model.pullRequestFilters, defaultGitPrFilterConfig),
);

function openFilters() {
  draft = createGitPrFilterDraft(model.pullRequestFilters);
  filtersOpen = true;
}

function applyFilters(event: SubmitEvent) {
  event.preventDefault();
  if (!canApply) return;
  void gitActions.configurePullRequests(repository, draftFilters);
  filtersOpen = false;
}

function resetFilters() {
  void gitActions.resetPullRequestConfig(repository);
  filtersOpen = false;
}

function tone(pr: GithubPr): StatusTone {
  switch (pr.checks.status) {
    case "passing":
      return "success";
    case "failing":
      return "destructive";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

function detail(pr: GithubPr): string {
  const parts = [`#${pr.number}`];
  if (pr.author) parts.push(pr.author);
  if (pr.isDraft) parts.push("Draft");
  parts.push(`+${pr.additions} −${pr.deletions}`);
  return parts.join(" · ");
}

function open(pr: GithubPr) {
  void openMobileCenter("pr", () =>
    gitActions.openPullRequest(repository, pr.number),
  );
}
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
      size={filterCount ? "sm" : "icon-sm"}
      ariaLabel={filterCount
        ? `Pull request filters, ${filterCount} active`
        : "Pull request filters"}
      onclick={openFilters}
    >
      <ListFilter size={17} strokeWidth={1.9} />
      {#if filterCount}<Badge variant="info">{filterCount}</Badge>{/if}
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Refresh pull requests"
      disabled={model.loadingPullRequests}
      onclick={() => void gitActions.refreshPullRequests(repository)}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
  {/snippet}

  {#if model.pullRequestError}
    <p class="px-6 py-4 text-sm text-destructive">{model.pullRequestError}</p>
  {/if}

  {#if model.pullRequests.length}
    <MobileSection title="Open" meta={`${model.pullRequests.length}`}>
      {#each model.pullRequests as pr (pr.number)}
        <MobileListRow
          title={pr.title}
          detail={detail(pr)}
          meta={relativeTimeLabel(pr.updatedAt)}
          tone={tone(pr)}
          pulse={pr.checks.status === "pending"}
          onclick={() => open(pr)}
        />
      {/each}
    </MobileSection>
  {:else if model.loadingPullRequests}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">
      Loading pull requests…
    </p>
  {:else}
    <Empty.Root class="px-6 py-10">
      <Empty.Header>
        <Empty.Media class="text-muted-foreground">
          <GitPullRequest size={28} strokeWidth={1.6} />
        </Empty.Media>
        <Empty.Title class="text-sm">No open pull requests</Empty.Title>
        <Empty.Description class="text-xs">
          {model.github?.available === false
            ? "GitHub is not connected for this repository."
            : "Pull requests matching this repository's filters appear here."}
        </Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}
</MobileScreen>

<Sheet.Root open={filtersOpen} onOpenChange={(open) => (filtersOpen = open)}>
  <Sheet.Content
    side="bottom"
    class="max-h-[90dvh] rounded-t-lg pb-[env(safe-area-inset-bottom)]"
  >
    <Sheet.Title class="px-4 pb-1 pt-3 text-sm font-semibold"
      >Pull request filters</Sheet.Title
    >
    <form
      class="grid min-h-0 gap-4 overflow-y-auto px-4 pb-4"
      onsubmit={applyFilters}
    >
      <div class="grid gap-1.5">
        <Label>Author</Label>
        <ToggleGroup.Root
          type="single"
          size="sm"
          variant="outline"
          class="w-full"
          value={draft.author}
          aria-label="Pull request author"
          onValueChange={(value) => {
            if (value === "any" || value === "me" || value === "username")
              draft = { ...draft, author: value };
          }}
        >
          <ToggleGroup.Item value="any" class="flex-1">Any</ToggleGroup.Item>
          <ToggleGroup.Item value="me" class="flex-1">Me</ToggleGroup.Item>
          <ToggleGroup.Item value="username" class="flex-1"
            >User</ToggleGroup.Item
          >
        </ToggleGroup.Root>
        {#if draft.author === "username"}
          <Input
            bind:value={draft.username}
            placeholder="GitHub username"
            aria-label="GitHub username"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
          />
        {/if}
      </div>
      <div class="grid gap-1.5">
        <Label>Drafts</Label>
        <ToggleGroup.Root
          type="single"
          size="sm"
          variant="outline"
          class="w-full"
          value={draft.drafts}
          aria-label="Draft pull requests"
          onValueChange={(value) => {
            if (value === "include" || value === "exclude" || value === "only")
              draft = { ...draft, drafts: value };
          }}
        >
          <ToggleGroup.Item value="include" class="flex-1"
            >Include</ToggleGroup.Item
          >
          <ToggleGroup.Item value="exclude" class="flex-1"
            >Exclude</ToggleGroup.Item
          >
          <ToggleGroup.Item value="only" class="flex-1">Only</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      <div class="grid gap-1.5">
        <Label for="mobile-pr-title">Title contains</Label>
        <Input id="mobile-pr-title" bind:value={draft.title} />
      </div>
      <div class="grid gap-1.5">
        <Label for="mobile-pr-labels">Labels</Label>
        <Input
          id="mobile-pr-labels"
          bind:value={draft.labels}
          placeholder="bug, needs-review"
          autocapitalize="off"
        />
        <p class="text-xs text-muted-foreground">Comma-separated.</p>
      </div>
      <SwitchField
        bind:checked={draft.currentBranchOnly}
        label="Current branch only"
        disabled={!hasCurrentBranch}
      />
      <div class="grid gap-1.5">
        <Label>Sort</Label>
        <ToggleGroup.Root
          type="single"
          size="sm"
          variant="outline"
          class="w-full"
          value={draft.sort}
          aria-label="Sort pull requests"
          onValueChange={(value) => {
            if (value === "updated-desc" || value === "updated-asc")
              draft = { ...draft, sort: value };
          }}
        >
          <ToggleGroup.Item value="updated-desc" class="flex-1"
            >Newest</ToggleGroup.Item
          >
          <ToggleGroup.Item value="updated-asc" class="flex-1"
            >Oldest</ToggleGroup.Item
          >
        </ToggleGroup.Root>
      </div>
      <div class="flex justify-between gap-2">
        <Button variant="ghost" disabled={!canReset} onclick={resetFilters}
          >Reset</Button
        >
        <Button type="submit" disabled={!canApply}>Apply</Button>
      </div>
    </form>
  </Sheet.Content>
</Sheet.Root>
