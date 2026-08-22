<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import ExternalLink from "@lucide/svelte/icons/external-link";
import X from "@lucide/svelte/icons/x";
import type { GithubChecksSummary } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { githubCheckRunOutcome } from "./github-pr-checks";
import GithubPrSection from "./GithubPrSection.svelte";
import { checksTone, sortCheckRuns } from "./pr-pane-helpers";

type Props = { checks: GithubChecksSummary };
let { checks }: Props = $props();
const sortedRuns = $derived(sortCheckRuns(checks.runs));
const hasCounts = $derived(checks.passed + checks.failed + checks.pending > 0);
</script>

<GithubPrSection title="Checks" contentClass="p-0">
  {#snippet actions()}
    <Badge tone={checksTone(checks)} size="xs">
      {#if checks.status === "passing"}
        <Check class="size-3" aria-hidden="true" />
      {:else if checks.status === "failing"}
        <X class="size-3" aria-hidden="true" />
      {:else if checks.status === "pending"}
        <Spinner class="size-3" />
      {:else}
        <CircleDot class="size-3" aria-hidden="true" />
      {/if}
      {checks.status === "none" ? "No checks" : checks.status}
    </Badge>
  {/snippet}

  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-muted-foreground"
  >
    {#if hasCounts}
      {#if checks.passed > 0}
        <span class="inline-flex items-center gap-1 text-success">
          <Check class="size-3" aria-hidden="true" />
          {checks.passed} passed
        </span>
      {/if}
      {#if checks.failed > 0}
        <span class="inline-flex items-center gap-1 text-destructive">
          <X class="size-3" aria-hidden="true" />
          {checks.failed} failed
        </span>
      {/if}
      {#if checks.pending > 0}
        <span class="inline-flex items-center gap-1 text-warning">
          <Spinner class="size-3" />
          {checks.pending} pending
        </span>
      {/if}
    {:else}
      <span>No checks have been reported.</span>
    {/if}
  </div>

  {#if checks.runs.length === 0}
    {#if hasCounts}
      <p
        class="border-t border-border/50 px-3 py-2 text-xs text-muted-foreground"
      >
        No individual check runs to show.
      </p>
    {/if}
  {:else}
    <ul
      class="divide-y divide-border/50 border-t border-border/50"
      aria-label="Check runs"
    >
      {#each sortedRuns as run (`${run.name}:${run.url ?? ""}`)}
        {@const outcome = githubCheckRunOutcome(run.status)}
        <li
          class="flex min-w-0 items-center gap-2 px-3 py-1.5 hover:bg-accent/40"
        >
          <span class="min-w-0 flex-1 truncate text-foreground">{run.name}</span
          >
          {#if run.url}
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              class="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Open ${run.name} on GitHub`}
            >
              <ExternalLink class="size-3" />
            </a>
          {/if}
          <span
            class="flex size-4 shrink-0 items-center justify-center"
            title={run.status}
          >
            {#if outcome === "passed"}
              <Check class="size-3.5 text-success" aria-hidden="true" />
            {:else if outcome === "failed"}
              <X class="size-3.5 text-destructive" aria-hidden="true" />
            {:else}
              <Spinner class="size-3.5 text-warning" />
            {/if}
            <span class="sr-only">{run.status}</span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</GithubPrSection>
