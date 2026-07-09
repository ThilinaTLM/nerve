<script lang="ts">
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import Check from "@lucide/svelte/icons/check";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import { isGithubChecksPending } from "./github-pr-checks";
  import Markdown from "@nervekit/shared-ui/core/components/Markdown.svelte";
  import { notifyCopyResult } from "@nervekit/shared-ui/core/notify";
  import type { PrViewState } from "./github-pr-types";
  import {
    checksTone,
    formatPrDate,
    reviewTone,
    runTone,
    stateLabel,
    stateTone,
  } from "./pr-pane-helpers";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import { ScrollArea } from "@nervekit/shared-ui/components/ui/scroll-area";

  type Props = {
    view?: PrViewState;
    onRefresh?: () => void;
    onCheckout?: () => void;
    onOpenExternal?: () => void;
  };

  const PR_CHECKS_POLL_MS = 10_000;

  let { view, onRefresh, onCheckout, onOpenExternal }: Props = $props();

  const detail = $derived(view?.detail);
  const checksPending = $derived(isGithubChecksPending(detail?.checks));

  function confirmCheckout() {
    if (!detail) return;
    if (
      window.confirm(
        `Check out PR #${detail.number} (${detail.headRefName}) in this repo?`,
      )
    ) {
      onCheckout?.();
    }
  }

  $effect(() => {
    const viewId = view?.id;
    const pending = checksPending;
    if (!viewId || !pending || !onRefresh) return;

    const refreshPendingPr = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      onRefresh();
    };

    refreshPendingPr();
    const intervalId = window.setInterval(refreshPendingPr, PR_CHECKS_POLL_MS);
    return () => window.clearInterval(intervalId);
  });
</script>

<section class="pr-pane">
  <ScrollArea class="pr-scroll" viewportClass="pr-viewport" type="auto">
    {#if !view}
      <div class="pr-empty">
        <GitPullRequest size={28} strokeWidth={1.7} />
        <strong>No pull request selected</strong>
        <p>Open a PR from the Git panel to view its details here.</p>
      </div>
    {:else if view.loading && !detail}
      <div class="pr-empty">
        <RefreshCw class="spin" size={28} strokeWidth={1.7} />
        <strong>Loading pull request</strong>
        <p>#{view.number}</p>
      </div>
    {:else if view.error && !detail}
      <div class="pr-empty danger">
        <TriangleAlert size={28} strokeWidth={1.7} />
        <strong>Could not open pull request</strong>
        <p>{view.error}</p>
      </div>
    {:else if detail}
      <header class="pr-header">
        <div class="pr-title-row">
          <span class="pr-number">#{detail.number}</span>
          <h1 class="pr-title">{detail.title}</h1>
        </div>

        <div class="pr-meta">
          <Badge tone={stateTone(detail)} size="sm">{stateLabel(detail)}</Badge>
          <Badge tone={checksTone(detail.checks)} size="sm">
            {#if detail.checks.status === "passing"}
              <Check size={11} />
            {:else if detail.checks.status === "failing"}
              <X size={11} />
            {:else if detail.checks.status === "pending"}
              <LoaderCircle class="spin" size={11} />
            {/if}
            {detail.checks.status === "none"
              ? "no checks"
              : `${detail.checks.passed}/${detail.checks.total} checks`}
          </Badge>
          {#if detail.reviewDecision}
            <Badge tone={reviewTone(detail.reviewDecision)} size="sm">
              {detail.reviewDecision.replace("_", " ").toLowerCase()}
            </Badge>
          {/if}
          <span class="pr-branches">
            <span class="mono">{detail.baseRefName}</span>
            ←
            <span class="mono">{detail.headRefName}</span>
          </span>
        </div>

        <div class="pr-subline">
          {#if detail.author}<span>by <span class="mono">{detail.author}</span></span>{/if}
          {#if detail.createdAt}<span>opened {formatPrDate(detail.createdAt)}</span>{/if}
          <span class="mono diffstat">
            <span class="add">+{detail.additions}</span>
            <span class="del">−{detail.deletions}</span>
            · {detail.changedFiles} files
          </span>
        </div>

        <div class="pr-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={view.loading}
            onclick={() => onRefresh?.()}
          >
            <RefreshCw class={view.loading ? "spin" : ""} size={14} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onclick={() => onOpenExternal?.()}>
            <ExternalLink size={14} />
            Open in browser
          </Button>
          <Button size="sm" variant="outline" onclick={confirmCheckout}>
            <ArrowDownToLine size={14} />
            Checkout branch
          </Button>
        </div>
      </header>

      {#if detail.checks.runs.length > 0}
        <section class="pr-section">
          <h2>Checks</h2>
          <ul class="pr-list">
            {#each detail.checks.runs as run (run.name)}
              <li class="pr-run">
                <Badge tone={runTone(run.status)} size="xs">
                  {run.status}
                </Badge>
                <span class="truncate">{run.name}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section class="pr-section">
        <h2>Description</h2>
        {#if detail.body.trim()}
          <div class="pr-body"><Markdown text={detail.body} onCopy={notifyCopyResult} /></div>
        {:else}
          <p class="pr-muted">No description provided.</p>
        {/if}
      </section>

      <section class="pr-section">
        <h2>Files changed ({detail.changedFiles})</h2>
        {#if detail.files.length === 0}
          <p class="pr-muted">No file data available.</p>
        {:else}
          <ul class="pr-list">
            {#each detail.files as file (file.path)}
              <li class="pr-file">
                <span class="mono truncate" title={file.path}>{file.path}</span>
                <span class="mono diffstat">
                  <span class="add">+{file.additions}</span>
                  <span class="del">−{file.deletions}</span>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="pr-section">
        <h2>Commits ({detail.commits.length})</h2>
        {#if detail.commits.length === 0}
          <p class="pr-muted">No commit data available.</p>
        {:else}
          <ul class="pr-list">
            {#each detail.commits as commit (commit.oid)}
              <li class="pr-commit">
                <GitCommitHorizontal size={13} strokeWidth={2.1} />
                <span class="mono pr-hash">{commit.abbrev}</span>
                <span class="truncate">{commit.messageHeadline}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </ScrollArea>
</section>

<style>
  .pr-pane {
    display: grid;
    height: 100%;
    min-height: 0;
    background: var(--background);
  }

  :global(.pr-scroll) {
    min-height: 0;
  }

  :global(.pr-viewport) {
    padding: 1.1rem 1.25rem 4rem;
  }

  .pr-empty {
    display: grid;
    min-height: 18rem;
    place-items: center;
    align-content: center;
    gap: 0.35rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .pr-empty :global(svg) {
    color: var(--primary);
  }

  .pr-empty.danger :global(svg) {
    color: var(--destructive);
  }

  .pr-empty strong {
    color: var(--foreground);
  }

  .pr-header {
    display: grid;
    gap: 0.6rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .pr-title-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .pr-number {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .pr-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: 1.25;
    color: var(--foreground);
  }

  .pr-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--text-sm);
  }

  .pr-branches {
    color: var(--muted-foreground);
  }

  .pr-subline {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .pr-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.25rem;
  }

  .pr-section {
    margin-top: 1.4rem;
  }

  .pr-section h2 {
    margin: 0 0 0.5rem;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--foreground);
  }

  .pr-list {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pr-run,
  .pr-file,
  .pr-commit {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--foreground);
  }

  .pr-file {
    justify-content: space-between;
  }

  .pr-commit :global(svg) {
    flex: none;
    color: var(--muted-foreground);
  }

  .pr-hash {
    color: var(--muted-foreground);
  }

  .pr-body {
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  .pr-muted {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .truncate {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diffstat {
    flex: none;
    white-space: nowrap;
    color: var(--muted-foreground);
  }

  .diffstat .add {
    color: var(--success);
  }

  .diffstat .del {
    color: var(--destructive);
  }

</style>
