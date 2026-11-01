<script lang="ts">
import type { Component, Snippet } from "svelte";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import ExternalLink from "@lucide/svelte/icons/external-link";
import GitMerge from "@lucide/svelte/icons/git-merge";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestClosed from "@lucide/svelte/icons/git-pull-request-closed";
import GitPullRequestDraft from "@lucide/svelte/icons/git-pull-request-draft";
import Link2 from "@lucide/svelte/icons/link-2";
import MonitorCheck from "@lucide/svelte/icons/monitor-check";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { GithubPr, GithubPrCore } from "@nervekit/contracts/git";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { cn } from "@nervekit/ui-kit/utils";
import { formatPrDateCompact, formatRelativeAge } from "../pr-pane-helpers";
import PrAvatar from "./PrAvatar.svelte";
import PrTooltip from "./PrTooltip.svelte";

type Props = {
  number: number;
  core?: GithubPrCore;
  /** List row data, shown while the full pull request loads. */
  summary?: GithubPr;
  refreshing: boolean;
  checkedOut: boolean;
  onRefresh?: () => void;
  onCopyLink?: () => void;
  onOpenExternal?: () => void;
  /** Primary actions (merge, ready for review, check out). */
  actions?: Snippet;
};

let {
  number,
  core,
  summary,
  refreshing,
  checkedOut,
  onRefresh,
  onCopyLink,
  onOpenExternal,
  actions,
}: Props = $props();

const display = $derived(core ?? summary);

type StateKind = "open" | "draft" | "merged" | "closed";
const STATES: Record<
  StateKind,
  { icon: Component; tone: string; label: string }
> = {
  open: { icon: GitPullRequest, tone: "text-success", label: "Open" },
  draft: {
    icon: GitPullRequestDraft,
    tone: "text-muted-foreground",
    label: "Draft",
  },
  merged: { icon: GitMerge, tone: "text-info", label: "Merged" },
  closed: {
    icon: GitPullRequestClosed,
    tone: "text-destructive",
    label: "Closed",
  },
};
const kind = $derived<StateKind>(
  display?.isDraft
    ? "draft"
    : display?.state === "MERGED"
      ? "merged"
      : display?.state === "CLOSED"
        ? "closed"
        : "open",
);
const StateIcon = $derived(STATES[kind].icon);
</script>

{#snippet stateIcon()}
  <StateIcon
    class={cn("mt-1 size-4 shrink-0", STATES[kind].tone)}
    aria-label={STATES[kind].label}
  />
{/snippet}

<header class="flex flex-col gap-1 px-4 pt-3 pb-2">
  <div class="flex items-start gap-2">
    <h1
      class="flex min-w-0 flex-1 items-start gap-2 text-title leading-snug font-semibold"
    >
      {#if display}
        <PrTooltip label={STATES[kind].label}>{@render stateIcon()}</PrTooltip>
        <span class="min-w-0">
          {display.title}
          <span class="inline-flex items-center gap-0.5 align-middle">
            <span class="font-normal text-muted-foreground">#{number}</span>
            <IconAction
              icon={Link2}
              label="Copy link"
              onclick={() => onCopyLink?.()}
            />
            <IconAction
              icon={ExternalLink}
              label="Open in browser"
              onclick={() => onOpenExternal?.()}
            />
          </span>
        </span>
      {:else}
        <Skeleton class="mt-1 size-4 shrink-0 rounded-full" />
        <Skeleton class="h-6 w-2/3" />
        <span class="font-normal text-muted-foreground">#{number}</span>
      {/if}
    </h1>
    <IconAction
      icon={RefreshCw}
      label="Refresh"
      onclick={() => onRefresh?.()}
      busy={refreshing}
    />
  </div>

  <p class="flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground">
    {#if display}
      {#if display.author}
        <PrAvatar name={display.author} />
        <span class="shrink-0">{display.author}</span>
        <span aria-hidden="true">·</span>
      {/if}
      {#if core}
        <PrTooltip label={formatPrDateCompact(core.createdAt)}>
          <span class="whitespace-nowrap"
            >{formatRelativeAge(core.createdAt)}</span
          >
        </PrTooltip>
        <span aria-hidden="true">·</span>
      {/if}
      <span class="min-w-0 truncate font-mono" title={display.headRefName}
        >{display.headRefName}</span
      >
      <ArrowRight class="size-3 shrink-0" aria-hidden="true" />
      <span class="shrink-0 font-mono">{display.baseRefName}</span>
      {#if checkedOut}
        <PrTooltip label="Checked out in this workspace">
          <MonitorCheck
            class="size-3.5 shrink-0 text-foreground"
            aria-label="Checked out"
          />
        </PrTooltip>
      {/if}
    {:else}
      <Skeleton class="h-3 w-56" />
    {/if}
  </p>
</header>

<div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 pb-2">
  <p
    class="flex min-w-0 flex-1 items-center gap-2 text-ui text-muted-foreground"
  >
    {#if core}
      <span
        >{core.changedFiles} {core.changedFiles === 1 ? "file" : "files"}</span
      >
      <span class="text-success tabular-nums">+{core.additions}</span>
      <span class="text-destructive tabular-nums">−{core.deletions}</span>
    {:else}
      <Skeleton class="h-3 w-28" />
    {/if}
  </p>
  {#if core && actions}{@render actions()}{/if}
</div>
