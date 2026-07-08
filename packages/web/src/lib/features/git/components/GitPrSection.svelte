<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import X from "@lucide/svelte/icons/x";
  import type {
    GithubPr,
    GithubStatusResponse,
    GitRepoSummary,
  } from "$lib/api";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import { cn } from "@nervekit/shared-ui/core/utils";
  import { PanelSection } from "@nervekit/shared-ui/components/workbench";
  import { checksTone } from "./git-change-format";

  type Props = {
    sortedPrs: GithubPr[];
    prs: GithubPr[];
    selectedRepoSummary?: GitRepoSummary;
    github?: GithubStatusResponse;
    selectedRepoHasGithubRemote: boolean;
    loadingPrs: boolean;
    currentBranchName: string | null;
    expandedPr?: number;
    open?: boolean;
    onRefreshPrs: () => void;
    onOpenPr: (prNumber: number) => void;
  };

  let {
    sortedPrs,
    prs,
    selectedRepoSummary,
    github,
    selectedRepoHasGithubRemote,
    loadingPrs,
    currentBranchName,
    expandedPr = $bindable(undefined),
    open = $bindable(true),
    onRefreshPrs,
    onOpenPr,
  }: Props = $props();
</script>

<PanelSection title="PRs (GitHub)" icon={GitPullRequest} bind:open>
  {#snippet actions()}
    {#if selectedRepoHasGithubRemote && github?.authenticated}
      <Button
        size="icon-xs"
        variant="ghost"
        ariaLabel="Refresh PRs"
        title={`Refresh PRs · signed in as ${github.login ?? "unknown"}`}
        disabled={loadingPrs}
        onclick={() => onRefreshPrs()}
      >
        <RefreshCw class={loadingPrs ? "animate-spin" : ""} />
      </Button>
    {/if}
  {/snippet}

  {#if selectedRepoSummary && !selectedRepoSummary.hasRemote}
    <div class="py-1 text-xs text-muted-foreground">
      No remote configured for this repository.
    </div>
  {:else if selectedRepoSummary && !selectedRepoSummary.hasGithubRemote}
    <div class="py-1 text-xs text-muted-foreground">
      PRs are only available for GitHub remotes.
    </div>
  {:else if !github}
    <div class="py-1 text-xs text-muted-foreground">Checking GitHub CLI…</div>
  {:else if !github.available}
    <div class="py-1 text-xs text-muted-foreground">
      {github.reason ?? "GitHub CLI (gh) is not installed."}
    </div>
  {:else if !github.authenticated}
    <div class="py-1 text-xs text-muted-foreground">
      Not authenticated. Run <code class="font-mono">gh auth login</code>.
    </div>
  {:else if loadingPrs && prs.length === 0}
    <div class="py-1 text-xs text-muted-foreground">Loading…</div>
  {:else if sortedPrs.length === 0}
    <div class="py-1 text-xs text-muted-foreground">No open PRs for this repository.</div>
  {:else}
    <div class="flex flex-col gap-1.5">
      {#each sortedPrs as pr (pr.number)}
        {@const currentPr = currentBranchName !== null && pr.headRefName === currentBranchName}
        <div class={cn("rounded-md border px-2 py-1.5", currentPr && "border-accent bg-muted/40")}>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-foreground hover:underline"
              onclick={() => onOpenPr(pr.number)}
            >
              <span class="font-mono text-muted-foreground">#{pr.number}</span>
              <span class="truncate">{pr.title}</span>
            </button>
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              class="shrink-0 text-muted-foreground hover:text-foreground"
              title="Open in browser"
              aria-label="Open in browser"
            >
              <ExternalLink size={12} />
            </a>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            {#if currentPr}
              <Badge tone="accent" size="xs">current</Badge>
            {/if}
            {#if pr.isDraft}
              <Badge tone="neutral" size="xs">draft</Badge>
            {/if}
            <button
              type="button"
              title="Toggle check details"
              onclick={() => (expandedPr = expandedPr === pr.number ? undefined : pr.number)}
            >
              <Badge tone={checksTone(pr.checks)} size="xs">
                {#if pr.checks.status === "passing"}
                  <Check size={11} />
                {:else if pr.checks.status === "failing"}
                  <X size={11} />
                {:else if pr.checks.status === "pending"}
                  <LoaderCircle size={11} class="animate-spin" />
                {/if}
                {pr.checks.status === "none" ? "no checks" : `${pr.checks.passed}/${pr.checks.total}`}
              </Badge>
            </button>
            <span class="truncate font-mono text-xs text-muted-foreground">
              {pr.baseRefName} ← {pr.headRefName}
            </span>
          </div>
          {#if expandedPr === pr.number && pr.checks.runs.length > 0}
            <div class="mt-1.5 flex flex-col gap-1 rounded-md border bg-background px-2 py-1.5">
              {#each pr.checks.runs as run}
                <div class="flex items-center gap-1.5 text-xs">
                  <span class="font-mono text-muted-foreground">{run.status}</span>
                  <span class="truncate text-foreground">{run.name}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</PanelSection>
