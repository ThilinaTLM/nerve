<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ExternalLink from "@lucide/svelte/icons/external-link";
import X from "@lucide/svelte/icons/x";
import type { GithubPr } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/core/utils";
import { checksTone } from "./git-change-format";

type Props = {
  pr: GithubPr;
  current: boolean;
  expanded: boolean;
  disabled: boolean;
  disabledReason?: string;
  onOpen: () => void;
  onToggleChecks: () => void;
};

let {
  pr,
  current,
  expanded,
  disabled,
  disabledReason,
  onOpen,
  onToggleChecks,
}: Props = $props();

const hasCheckDetails = $derived(pr.checks.runs.length > 0);
</script>

<div
  role="listitem"
  class={cn(
    "group mb-1.5 flex min-w-0 flex-col rounded-md border px-2 py-1.5 text-xs shadow-xs transition-colors hover:border-primary/40",
    current && "border-primary/30 text-foreground",
  )}
>
  <button
    type="button"
    {disabled}
    aria-current={current ? "true" : undefined}
    title={disabled
      ? disabledReason
      : `${pr.title} · ${pr.baseRefName} ← ${pr.headRefName}`}
    class="flex h-5 min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
    onclick={onOpen}
  >
    <span class="shrink-0 font-mono font-medium text-foreground"
      >#{pr.number}</span
    >
    <span class="min-w-0 flex-1 truncate text-foreground">{pr.title}</span>
    {#if pr.isDraft}
      <Badge tone="neutral" size="xs">draft</Badge>
    {/if}
  </button>

  <div class="flex h-6 min-w-0 items-center gap-1">
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
    <div class="mt-1 border-t pt-1">
      {#each pr.checks.runs as run, index (`${run.name}:${index}`)}
        <div class="flex h-5 min-w-0 items-center gap-1.5 pl-3 text-xs">
          <span class="min-w-0 flex-1 truncate text-muted-foreground"
            >{run.name}</span
          >
          <span class="shrink-0 text-muted-foreground">{run.status}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
