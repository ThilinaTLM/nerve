<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ExternalLink from "@lucide/svelte/icons/external-link";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import ListFilter from "@lucide/svelte/icons/list-filter";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import X from "@lucide/svelte/icons/x";
import type {
  GithubPr,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import {
  PanelList,
  PanelRow,
  PanelSection,
  PanelToolbarButton,
} from "@nervekit/workbench-ui/panel";
import { checksTone } from "./git-change-format";
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
  selectedRepoSummary?: GitRepoSummary;
  github?: GithubStatusResponse;
  selectedRepoHasGithubRemote: boolean;
  loadingPrs: boolean;
  currentBranchName: string | null;
  capabilities: GitPanelCapabilities;
  expandedPr?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onExpandedPrChange?: (number: number | undefined) => void;
  onRefreshPrs: () => void;
  onOpenFilters: () => void;
  onOpenPr: (prNumber: number) => void;
};

let {
  displayedPrs,
  prs,
  filters,
  selectedRepoSummary,
  github,
  selectedRepoHasGithubRemote,
  loadingPrs,
  currentBranchName,
  capabilities,
  expandedPr = $bindable(undefined),
  open = $bindable(true),
  onOpenChange,
  onExpandedPrChange,
  onRefreshPrs,
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
  <p class="px-2 py-1 text-xs text-muted-foreground">{text}</p>
{/snippet}

<PanelSection
  title="Pull Requests"
  icon={GitPullRequest}
  count={displayedPrs.length > 0 ? displayedPrs.length : undefined}
  bind:open
  {onOpenChange}
>
  {#snippet actions()}
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
        onclick={() => onRefreshPrs()}
      />
    {/if}
  {/snippet}

  {#if selectedRepoSummary && !selectedRepoSummary.hasRemote}
    {@render note("No remote configured for this repository.")}
  {:else if selectedRepoSummary && !selectedRepoSummary.hasGithubRemote}
    {@render note("PRs are only available for GitHub remotes.")}
  {:else if !github}
    {@render note("Checking GitHub CLI…")}
  {:else if !github.available}
    {@render note(github.reason ?? "GitHub CLI (gh) is not installed.")}
  {:else if !github.authenticated}
    {@render note("Not authenticated. Run `gh auth login`.")}
  {:else if loadingPrs && prs.length === 0}
    {@render note("Loading…")}
  {:else if displayedPrs.length === 0}
    {@render note(
      hasActiveGitPrFilters(filters)
        ? "No pull requests match these filters."
        : "No open PRs for this repository.",
    )}
  {:else}
    <PanelList ariaLabel="Pull requests">
      {#each displayedPrs as pr (pr.number)}
        {@const currentPr =
          currentBranchName !== null && pr.headRefName === currentBranchName}
        <PanelRow
          label={`#${pr.number}`}
          description={pr.title}
          title={capabilities.openPullRequest.enabled
            ? `${pr.title} · ${pr.baseRefName} ← ${pr.headRefName}`
            : capabilities.openPullRequest.reason}
          mono
          indent={1}
          active={currentPr}
          disabled={!capabilities.openPullRequest.enabled}
          onclick={() => onOpenPr(pr.number)}
        >
          {#snippet badges()}
            {#if pr.isDraft}
              <Badge tone="neutral" size="xs">draft</Badge>
            {/if}
            <button
              type="button"
              title="Toggle check details"
              onclick={() => toggleChecks(pr)}
            >
              <Badge tone={checksTone(pr.checks)} size="xs">
                {#if pr.checks.status === "passing"}
                  <Check size={11} />
                {:else if pr.checks.status === "failing"}
                  <X size={11} />
                {:else if pr.checks.status === "pending"}
                  <Spinner class="size-3" />
                {/if}
                {pr.checks.status === "none"
                  ? "no checks"
                  : `${pr.checks.passed}/${pr.checks.total}`}
              </Badge>
            </button>
          {/snippet}
          {#snippet actions()}
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              title="Open in browser"
              aria-label={`Open PR #${pr.number} in browser`}
            >
              <ExternalLink size={12} />
            </a>
          {/snippet}
        </PanelRow>
        {#if expandedPr === pr.number && pr.checks.runs.length > 0}
          {#each pr.checks.runs as run, index (`${run.name}:${index}`)}
            <PanelRow
              label={run.name}
              description={run.status}
              indent={2}
              tone="muted"
            />
          {/each}
        {/if}
      {/each}
    </PanelList>
  {/if}
</PanelSection>
