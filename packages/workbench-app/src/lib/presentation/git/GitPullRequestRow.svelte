<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ExternalLink from "@lucide/svelte/icons/external-link";
import X from "@lucide/svelte/icons/x";
import type { GithubPr } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { checksTone } from "./git-change-format";
import { githubCheckRunOutcome } from "./github-pr-checks";

type Props = {
  pr: GithubPr;
  expanded: boolean;
  disabled: boolean;
  disabledReason?: string;
  onOpen: () => void;
  onToggleChecks: () => void;
};

let { pr, expanded, disabled, disabledReason, onOpen, onToggleChecks }: Props =
  $props();

const hasCheckDetails = $derived(pr.checks.runs.length > 0);
</script>

<div
  role="listitem"
  class="group flex min-w-0 flex-col gap-1 rounded-md bg-accent/35 px-3 py-2.5 text-xs leading-tight transition-colors hover:bg-accent/60"
>
  <button
    type="button"
    {disabled}
    title={disabled
      ? disabledReason
      : `${pr.title} · ${pr.baseRefName} ← ${pr.headRefName}`}
    class="group/title flex min-w-0 cursor-pointer items-start gap-1.5 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    onclick={onOpen}
  >
    <span class="shrink-0 font-mono font-medium text-foreground"
      >#{pr.number}</span
    >
    <span
      class="line-clamp-2 min-w-0 flex-1 break-words text-foreground underline-offset-2 group-hover/title:underline"
      >{pr.title}</span
    >
    {#if pr.isDraft}
      <Badge tone="neutral" size="xs">draft</Badge>
    {/if}
  </button>

  <div class="flex min-w-0 items-center gap-1">
    <button
      type="button"
      disabled={!hasCheckDetails}
      aria-expanded={hasCheckDetails ? expanded : undefined}
      title={hasCheckDetails
        ? `${expanded ? "Collapse" : "Expand"} check details`
        : "No check details"}
      class="rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none"
      onclick={onToggleChecks}
    >
      <Badge tone={checksTone(pr.checks)} size="xs">
        {#if pr.checks.status === "passing"}
          <Check class="size-3" aria-hidden="true" />
        {:else if pr.checks.status === "failing"}
          <X class="size-3" aria-hidden="true" />
        {:else if pr.checks.status === "pending"}
          <Spinner class="size-3" />
        {/if}
        {pr.checks.status === "none"
          ? "no checks"
          : `${pr.checks.passed}/${pr.checks.total} checks`}
      </Badge>
    </button>

    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      class="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      title="Open in browser"
      aria-label={`Open PR #${pr.number} in browser`}
    >
      <ExternalLink class="size-3" aria-hidden="true" />
    </a>
  </div>

  {#if expanded && hasCheckDetails}
    <div class="mt-1 flex flex-col gap-0.5 border-t border-border/60 pt-1.5">
      {#each pr.checks.runs as run, index (`${run.name}:${index}`)}
        {@const outcome = githubCheckRunOutcome(run.status)}
        <div class="flex min-w-0 items-center gap-1.5 pl-3 text-xs">
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
</div>
