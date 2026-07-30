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
import type { GithubPrCore } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { formatPrDateCompact, stateLabel, stateTone } from "./pr-pane-helpers";

type Props = {
  detail: GithubPrCore;
  loading: boolean;
  commitCount?: number;
  onRefresh?: () => void;
  onCheckout?: () => void;
  onOpenExternal?: () => void;
};

let {
  detail,
  loading,
  commitCount,
  onRefresh,
  onCheckout,
  onOpenExternal,
}: Props = $props();

const StateIcon = $derived(
  detail.isDraft
    ? GitPullRequestDraft
    : detail.state === "MERGED"
      ? GitMerge
      : detail.state === "CLOSED"
        ? CircleSlash
        : GitPullRequest,
);
</script>

<header class="border-b bg-background px-4 py-2.5">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <Badge tone={stateTone(detail)} size="sm" class="shrink-0">
          <StateIcon class="size-3" aria-hidden="true" />
          {stateLabel(detail)}
        </Badge>
        <h1
          class="min-w-0 truncate text-base font-semibold leading-snug text-foreground"
          title={detail.title}
        >
          {detail.title}
          <span class="ml-1 font-normal text-muted-foreground"
            >#{detail.number}</span
          >
        </h1>
      </div>

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

      <div
        class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <span
          class="inline-flex items-center gap-1"
          aria-label={`Merges ${detail.headRefName} into ${detail.baseRefName}`}
        >
          <Badge variant="outline" size="xs" class="font-mono"
            >{detail.baseRefName}</Badge
          >
          <ArrowLeft class="size-3" aria-hidden="true" />
          <Badge variant="outline" size="xs" class="font-mono"
            >{detail.headRefName}</Badge
          >
        </span>
        {#if commitCount !== undefined}
          <span
            class="inline-flex items-center gap-1"
            title={`${commitCount} ${commitCount === 1 ? "commit" : "commits"}`}
          >
            <GitCommitHorizontal class="size-3.5" aria-hidden="true" />
            <span class="font-medium text-foreground">{commitCount}</span>
            <span class="sr-only"
              >{commitCount === 1 ? "commit" : "commits"}</span
            >
          </span>
        {/if}
        <span
          class="inline-flex items-center gap-1"
          title={`${detail.changedFiles} changed ${detail.changedFiles === 1 ? "file" : "files"}`}
        >
          <FileDiff class="size-3.5" aria-hidden="true" />
          <span class="font-medium text-foreground">{detail.changedFiles}</span>
          <span class="sr-only"
            >changed {detail.changedFiles === 1 ? "file" : "files"}</span
          >
        </span>
        <span
          class="inline-flex items-center gap-1.5"
          title={`${detail.additions} additions, ${detail.deletions} deletions`}
        >
          <span class="font-mono text-success">+{detail.additions}</span>
          <span class="font-mono text-destructive">−{detail.deletions}</span>
          <span class="sr-only"
            >{detail.additions} additions and {detail.deletions} deletions</span
          >
        </span>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <Button
        size="xs"
        variant="outline"
        title="Refresh pull request"
        aria-label="Refresh pull request"
        disabled={loading}
        onclick={() => onRefresh?.()}
      >
        {#if loading}
          <Spinner class="size-3" />
        {:else}
          <RefreshCw class="size-3" />
        {/if}
        Refresh
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Open pull request in browser"
        aria-label="Open pull request in browser"
        onclick={() => onOpenExternal?.()}
      >
        <ExternalLink class="size-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Check out pull request branch"
        aria-label="Check out pull request branch"
        onclick={() => onCheckout?.()}
      >
        <ArrowDownToLine class="size-3.5" />
      </Button>
    </div>
  </div>
</header>
