<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import CircleSlash from "@lucide/svelte/icons/circle-slash";
import ExternalLink from "@lucide/svelte/icons/external-link";
import GitMerge from "@lucide/svelte/icons/git-merge";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestDraft from "@lucide/svelte/icons/git-pull-request-draft";
import Link from "@lucide/svelte/icons/link";
import MessageSquare from "@lucide/svelte/icons/message-square";
import X from "@lucide/svelte/icons/x";
import type { GithubPr } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { ItemSurface } from "$lib/presentation/items";
import { checksTone, formatCompactAge, stateTone } from "./pr-pane-helpers";
import { githubCheckRunOutcome } from "./github-pr-checks";

type Props = {
  pr: GithubPr;
  expanded: boolean;
  disabled: boolean;
  checkedOut?: boolean;
  disabledReason?: string;
  onOpen: () => void;
  onToggleChecks: () => void;
};

let {
  pr,
  expanded,
  disabled,
  checkedOut = false,
  disabledReason,
  onOpen,
  onToggleChecks,
}: Props = $props();

const hasCheckDetails = $derived(pr.checks.runs.length > 0);
const StateIcon = $derived(
  pr.isDraft
    ? GitPullRequestDraft
    : pr.state === "MERGED"
      ? GitMerge
      : pr.state === "CLOSED"
        ? CircleSlash
        : GitPullRequest,
);
/* The state icon carries the tone, so the row needs no extra state badge. */
const stateClass = $derived(
  {
    success: "text-success",
    destructive: "text-destructive",
    accent: "text-foreground",
    neutral: "text-muted-foreground",
    warning: "text-warning",
    info: "text-info",
  }[stateTone(pr)] ?? "text-muted-foreground",
);
const age = $derived(formatCompactAge(pr.updatedAt));

async function copyLink() {
  try {
    await writeClipboardText(pr.url);
    notify.success(`Copied link to PR #${pr.number}`);
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
</script>

<ItemSurface
  role="listitem"
  hover="default"
  class="group flex-col gap-1 px-2.5 py-2 text-xs leading-tight"
>
  <!-- Header line: identity and actions, so the title below keeps full width. -->
  <div class="flex min-w-0 items-center gap-1.5">
    <StateIcon
      class={`size-3.5 shrink-0 ${stateClass}`}
      aria-label={pr.isDraft ? "Draft pull request" : pr.state.toLowerCase()}
    />
    <span class="shrink-0 font-mono font-medium text-foreground"
      >#{pr.number}</span
    >
    <span class="min-w-0 shrink truncate text-muted-foreground">
      {pr.author ?? "unknown"}{age ? ` · ${age}` : ""}
    </span>
    {#if checkedOut}
      <Badge variant="info" class="shrink-0">
        <Check aria-hidden="true" />
        checked out
      </Badge>
    {/if}
    <!-- Metadata stays left-aligned; only the actions hug the right edge. -->
    <span class="min-w-0 flex-1"></span>
    <span
      class="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
    >
      <Button
        size="icon-xs"
        variant="ghost"
        title="Copy pull request link"
        aria-label={`Copy link to PR #${pr.number}`}
        onclick={() => void copyLink()}
      >
        <Link aria-hidden="true" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        title="Open on GitHub"
        aria-label={`Open PR #${pr.number} on GitHub`}
      >
        <ExternalLink aria-hidden="true" />
      </Button>
    </span>
  </div>

  <button
    type="button"
    {disabled}
    title={disabled
      ? disabledReason
      : `${pr.title} · ${pr.baseRefName} ← ${pr.headRefName}`}
    class="cursor-pointer rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    onclick={onOpen}
  >
    <span
      class="line-clamp-2 break-words text-foreground underline-offset-2 hover:underline"
      >{pr.title}</span
    >
  </button>

  <div class="flex min-w-0 items-center gap-2">
    <button
      type="button"
      disabled={!hasCheckDetails}
      aria-expanded={hasCheckDetails ? expanded : undefined}
      title={hasCheckDetails
        ? `${expanded ? "Collapse" : "Expand"} check details`
        : "No check details"}
      class="shrink-0 rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none"
      onclick={onToggleChecks}
    >
      <Badge variant={checksTone(pr.checks)}>
        {#if pr.checks.status === "passing"}
          <Check class="size-3" aria-hidden="true" />
        {:else if pr.checks.status === "failing"}
          <X class="size-3" aria-hidden="true" />
        {:else if pr.checks.status === "pending"}
          <Spinner class="size-3" />
        {/if}
        {pr.checks.status === "none"
          ? "no checks"
          : `${pr.checks.passed}/${pr.checks.total}`}
      </Badge>
    </button>

    {#if pr.commentCount > 0}
      <span
        class="flex shrink-0 items-center gap-1 text-muted-foreground"
        title={`${pr.commentCount} comments`}
      >
        <MessageSquare class="size-3" aria-hidden="true" />
        {pr.commentCount}
      </span>
    {/if}

    <span class="min-w-0 flex-1"></span>

    <span
      class="shrink-0 font-mono text-[0.6875rem] tabular-nums"
      title={`${pr.additions} additions, ${pr.deletions} deletions`}
    >
      <span class="text-success">+{pr.additions}</span>
      <span class="text-destructive">−{pr.deletions}</span>
    </span>
  </div>

  {#if expanded && hasCheckDetails}
    <div class="mt-0.5 flex flex-col gap-0.5">
      {#each pr.checks.runs as run, index (`${run.name}:${index}`)}
        {@const outcome = githubCheckRunOutcome(run.status)}
        <div class="flex min-w-0 items-center gap-1.5 pl-1 text-xs">
          <span class="min-w-0 flex-1 truncate text-muted-foreground"
            >{run.name}</span
          >
          <span
            class="flex size-4 shrink-0 items-center justify-center"
            title={run.status}
          >
            {#if outcome === "passed"}
              <Check class="size-3 text-success" aria-hidden="true" />
            {:else if outcome === "failed"}
              <X class="size-3 text-destructive" aria-hidden="true" />
            {:else}
              <Spinner class="size-3 text-warning" />
            {/if}
            <span class="sr-only">{run.status}</span>
          </span>
        </div>
      {/each}
    </div>
  {/if}
</ItemSurface>
