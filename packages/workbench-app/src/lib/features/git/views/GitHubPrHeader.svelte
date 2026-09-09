<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Check from "@lucide/svelte/icons/check";
import CircleSlash from "@lucide/svelte/icons/circle-slash";
import ExternalLink from "@lucide/svelte/icons/external-link";
import FileDiff from "@lucide/svelte/icons/file-diff";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitMerge from "@lucide/svelte/icons/git-merge";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestDraft from "@lucide/svelte/icons/git-pull-request-draft";
import Link from "@lucide/svelte/icons/link";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GithubPr, GithubPrCore } from "@nervekit/contracts/git";
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
  /** True when the repository already has the PR head branch checked out. */
  checkedOut?: boolean;
  onRefresh?: () => void;
  onCheckout?: () => void;
  onCopyLink?: () => void;
  onOpenExternal?: () => void;
};

let {
  number,
  detail,
  summary,
  loading,
  commitCount,
  checkedOut = false,
  onRefresh,
  onCheckout,
  onCopyLink,
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
          <Badge variant={stateTone(display)} class="shrink-0">
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

      <!-- One meta line: who and when, the branch relationship, and size. -->
      <div
        class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      >
        {#if detail}
          <span>
            <span class="font-medium text-foreground"
              >{detail.author ?? "Unknown author"}</span
            >
            opened {formatPrDateCompact(detail.createdAt)}
          </span>
        {:else}
          <Skeleton class="h-3 w-40" />
        {/if}

        <span aria-hidden="true" class="text-muted-foreground/55">·</span>

        {#if display}
          <span
            class="inline-flex min-w-0 items-center gap-1"
            aria-label={`Merges ${display.headRefName} into ${display.baseRefName}`}
          >
            <Badge variant="outline" class="max-w-52 font-mono">
              <span class="truncate">{display.headRefName}</span>
            </Badge>
            <ArrowRight class="size-3 shrink-0" aria-hidden="true" />
            <Badge variant="outline" class="font-mono"
              >{display.baseRefName}</Badge
            >
          </span>
          {#if checkedOut}
            <Badge variant="info" title="This branch is checked out locally">
              <Check aria-hidden="true" />
              checked out
            </Badge>
          {/if}
        {:else}
          <Skeleton class="h-5 w-40 rounded-full" />
        {/if}

        <span aria-hidden="true" class="text-muted-foreground/55">·</span>

        {#if commitCount !== undefined}
          <span
            class="inline-flex items-center gap-1"
            title={`${commitCount} commits`}
          >
            <GitCommitHorizontal class="size-3.5" aria-hidden="true" />
            <span class="tabular-nums">{commitCount}</span>
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
            <span class="tabular-nums">{detail.changedFiles}</span>
          </span>
          <span
            class="inline-flex items-center gap-1.5 font-mono tabular-nums"
            title={`${detail.additions} additions, ${detail.deletions} deletions`}
          >
            <span class="text-success">+{detail.additions}</span>
            <span class="text-destructive">−{detail.deletions}</span>
          </span>
        {:else}
          <Skeleton class="h-3 w-24" />
        {/if}
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      <Button
        size="icon-xs"
        variant="ghost"
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
            aria-label={`Refreshing pull request #${number}`}
          />
        {:else}
          <RefreshCw aria-hidden="true" />
        {/if}
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Copy pull request link"
        aria-label="Copy pull request link"
        disabled={!display}
        onclick={() => onCopyLink?.()}
      >
        <Link aria-hidden="true" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Open pull request on GitHub"
        aria-label="Open pull request on GitHub"
        disabled={!display}
        onclick={() => onOpenExternal?.()}
      >
        <ExternalLink aria-hidden="true" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title={checkedOut
          ? `${display?.headRefName ?? "This branch"} is already checked out`
          : `Check out ${display?.headRefName ?? "this branch"} locally`}
        aria-label={checkedOut
          ? "Branch already checked out"
          : "Check out pull request branch"}
        disabled={!detail || checkedOut}
        onclick={() => onCheckout?.()}
      >
        {#if checkedOut}
          <Check class="text-success" aria-hidden="true" />
        {:else}
          <GitBranchPlus aria-hidden="true" />
        {/if}
      </Button>
    </div>
  </div>
</header>
