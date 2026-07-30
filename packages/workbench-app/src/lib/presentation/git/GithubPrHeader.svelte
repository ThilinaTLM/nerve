<script lang="ts">
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import CircleSlash from "@lucide/svelte/icons/circle-slash";
import ExternalLink from "@lucide/svelte/icons/external-link";
import FileDiff from "@lucide/svelte/icons/file-diff";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitMerge from "@lucide/svelte/icons/git-merge";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestDraft from "@lucide/svelte/icons/git-pull-request-draft";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GithubPr, GithubPrCore } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { formatPrDateCompact, stateLabel, stateTone } from "./pr-pane-helpers";

type Props = {
  number: number;
  detail?: GithubPrCore;
  summary?: GithubPr;
  loading: boolean;
  commitCount?: number;
  onRefresh?: () => void;
  onCheckout?: () => void;
  onOpenExternal?: () => void;
};

let {
  number,
  detail,
  summary,
  loading,
  commitCount,
  onRefresh,
  onCheckout,
  onOpenExternal,
}: Props = $props();
const display = $derived(detail ?? summary);
const StateIcon = $derived(
  display?.isDraft
    ? GitPullRequestDraft
    : display?.state === "MERGED"
      ? GitMerge
      : display?.state === "CLOSED"
        ? CircleSlash
        : GitPullRequest,
);
</script>

<header class="border-b bg-background px-4 py-2.5">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        {#if display}
          <Badge tone={stateTone(display)} size="sm" class="shrink-0">
            <StateIcon class="size-3" aria-hidden="true" />
            {stateLabel(display)}
          </Badge>
          <h1
            class="min-w-0 truncate text-base font-semibold leading-snug text-foreground"
            title={display.title}
          >
            {display.title}
            <span class="ml-1 font-normal text-muted-foreground">#{number}</span
            >
          </h1>
        {:else}
          <Skeleton class="h-5 w-16 shrink-0 rounded-full" />
          <Skeleton class="h-5 w-2/3" />
          <span class="shrink-0 text-base text-muted-foreground">#{number}</span
          >
        {/if}
      </div>

      {#if detail}
        <div
          class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
        >
          <span>
            Opened by <span class="font-medium text-foreground"
              >{detail.author ?? "Unknown author"}</span
            >
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatPrDateCompact(detail.createdAt)}</span>
        </div>
      {:else}
        <div
          class="mt-2 flex items-center gap-2"
          aria-label="Loading pull request author"
        >
          <Skeleton class="h-3 w-28" />
          <Skeleton class="h-3 w-16" />
        </div>
      {/if}

      <div
        class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        {#if display}
          <span
            class="inline-flex items-center gap-1"
            aria-label={`Merges ${display.headRefName} into ${display.baseRefName}`}
          >
            <Badge variant="outline" size="xs" class="font-mono"
              >{display.baseRefName}</Badge
            >
            <ArrowLeft class="size-3" aria-hidden="true" />
            <Badge variant="outline" size="xs" class="font-mono"
              >{display.headRefName}</Badge
            >
          </span>
        {:else}
          <Skeleton class="h-5 w-40 rounded-full" />
        {/if}
        {#if commitCount !== undefined}
          <span
            class="inline-flex items-center gap-1"
            title={`${commitCount} commits`}
          >
            <GitCommitHorizontal class="size-3.5" aria-hidden="true" />
            <span class="font-medium text-foreground">{commitCount}</span>
          </span>
        {:else if !detail}
          <Skeleton class="h-3 w-10" />
        {/if}
        {#if detail}
          <span
            class="inline-flex items-center gap-1"
            title={`${detail.changedFiles} changed files`}
          >
            <FileDiff class="size-3.5" aria-hidden="true" />
            <span class="font-medium text-foreground"
              >{detail.changedFiles}</span
            >
          </span>
          <span
            class="inline-flex items-center gap-1.5"
            title={`${detail.additions} additions, ${detail.deletions} deletions`}
          >
            <span class="font-mono text-success">+{detail.additions}</span>
            <span class="font-mono text-destructive">−{detail.deletions}</span>
          </span>
        {:else}
          <Skeleton class="h-3 w-24" />
        {/if}
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <Button
        size="xs"
        variant="outline"
        title="Refresh pull request"
        aria-label={loading
          ? `Refreshing pull request #${number}`
          : "Refresh pull request"}
        disabled={loading}
        onclick={() => onRefresh?.()}
      >
        {#if loading}
          <Spinner
            variant="refresh"
            class="size-3"
            aria-label={`Refreshing pull request #${number}`}
          />
        {:else}
          <RefreshCw class="size-3" aria-hidden="true" />
        {/if}
        Refresh
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Open pull request in browser"
        aria-label="Open pull request in browser"
        disabled={!display}
        onclick={() => onOpenExternal?.()}
      >
        <ExternalLink class="size-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Check out pull request branch"
        aria-label="Check out pull request branch"
        disabled={!detail}
        onclick={() => onCheckout?.()}
      >
        <ArrowDownToLine class="size-3.5" />
      </Button>
    </div>
  </div>
</header>
