<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleMinus from "@lucide/svelte/icons/circle-minus";
import CircleX from "@lucide/svelte/icons/circle-x";
import Clock from "@lucide/svelte/icons/clock";
import ExternalLink from "@lucide/svelte/icons/external-link";
import type {
  GithubChecksSummary,
  GithubCheckRun,
} from "@nervekit/contracts/git";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import {
  CHECK_GROUP_ORDER,
  checkRunGroup,
  checkRunSeconds,
  formatCheckDuration,
  summarizeCheckRuns,
  type CheckGroupStatus,
} from "../github-pr-checks";

type Props = { checks: GithubChecksSummary };
let { checks }: Props = $props();

/* Running durations tick once a second; settled checks need no timer. */
let now = $state(Date.now());
const summary = $derived(summarizeCheckRuns(checks.runs));
const ticking = $derived(summary.counts.running > 0);
$effect(() => {
  if (!ticking) return;
  now = Date.now();
  const timer = setInterval(() => (now = Date.now()), 1_000);
  return () => clearInterval(timer);
});

const GROUP_LABEL: Record<CheckGroupStatus, string> = {
  failed: "Failing",
  running: "Running",
  queued: "Queued",
  passed: "Passed",
  skipped: "Skipped",
};
const groups = $derived(
  CHECK_GROUP_ORDER.map((status) => ({
    status,
    runs: checks.runs.filter((run) => checkRunGroup(run) === status),
  })).filter((group) => group.runs.length > 0),
);
/* Proportional status bar, failures first so they are never hidden. */
const segments = $derived(
  [
    { tone: "bg-destructive", count: summary.counts.failed },
    {
      tone: "bg-warning",
      count: summary.counts.running + summary.counts.queued,
    },
    { tone: "bg-success", count: summary.counts.passed },
    { tone: "bg-border", count: summary.counts.skipped },
  ].filter((segment) => segment.count > 0),
);

function duration(run: GithubCheckRun): string {
  const seconds = checkRunSeconds(run, now);
  return seconds === undefined ? "" : formatCheckDuration(seconds);
}
</script>

{#snippet row(run: GithubCheckRun, group: CheckGroupStatus)}
  <li class="group/row flex items-start gap-2.5 px-3 py-2 hover:bg-hover">
    <span class="flex h-5 items-center">
      {#if group === "running"}
        <Spinner class="size-3.5 text-warning" />
      {:else if group === "failed"}
        <CircleX class="size-3.5 text-destructive" aria-hidden="true" />
      {:else if group === "queued"}
        <Clock class="size-3.5 text-muted-foreground" aria-hidden="true" />
      {:else if group === "passed"}
        <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
      {:else}
        <CircleMinus
          class="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      {/if}
    </span>
    <div class="min-w-0 flex-1">
      <p class="flex min-w-0 items-baseline gap-2">
        <span class="truncate text-ui">{run.name}</span>
        <span class="shrink-0 text-ui text-muted-foreground">
          {run.workflow ??
            ""}{#if run.required && group !== "passed"}{run.workflow
              ? "\u00a0· "
              : ""}required{/if}
        </span>
      </p>
      {#if run.summary && group === "failed"}
        <p
          class="mt-0.5 truncate font-mono text-ui text-muted-foreground"
          title={run.summary}
        >
          {run.summary}
        </p>
      {/if}
    </div>
    <span
      class="flex h-5 items-center text-ui text-muted-foreground tabular-nums"
    >
      {#if group === "queued"}
        waiting
      {:else if group !== "skipped"}
        {duration(run)}
      {/if}
    </span>
    {#if run.url}
      {@const url = run.url}
      <IconAction
        icon={ExternalLink}
        label="Open details"
        class="-my-0.5 text-muted-foreground group-hover/row:text-foreground"
        onclick={() => window.open(url, "_blank", "noopener")}
      />
    {:else}
      <span class="size-(--spacing-control-sm)" aria-hidden="true"></span>
    {/if}
  </li>
{/snippet}

<ScrollArea class="h-full">
  <div class="flex max-w-3xl flex-col gap-5 px-4 py-4">
    {#if checks.runs.length === 0}
      <p class="text-ui text-muted-foreground">No checks have been reported.</p>
    {:else}
      <header class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          {#if summary.counts.failed > 0}
            <CircleX class="size-4 text-destructive" aria-hidden="true" />
          {:else if summary.counts.running + summary.counts.queued > 0}
            <Spinner class="size-4 text-warning" />
          {:else}
            <CircleCheck class="size-4 text-success" aria-hidden="true" />
          {/if}
          <h2 class="text-title font-semibold">{summary.headline}</h2>
        </div>
        <div
          class="flex h-1 gap-px overflow-hidden rounded-full"
          aria-hidden="true"
        >
          {#each segments as segment (segment.tone)}
            <span class={segment.tone} style:flex-grow={segment.count}></span>
          {/each}
        </div>
        <p class="text-ui text-muted-foreground tabular-nums">
          {summary.complete} of {summary.total} complete{#if summary.requiredNotPassing > 0}&nbsp;·
            {summary.requiredNotPassing} required not passing{/if}
        </p>
      </header>

      {#each groups as group (group.status)}
        <section>
          <h3
            class="flex items-center gap-1.5 pb-1.5 text-ui font-medium text-muted-foreground"
          >
            {GROUP_LABEL[group.status]}
            <span class="font-normal tabular-nums">{group.runs.length}</span>
          </h3>
          <ul
            class="divide-y overflow-hidden rounded-md border bg-card"
            aria-label={GROUP_LABEL[group.status]}
          >
            {#each group.runs as run (`${run.name}:${run.url ?? ""}`)}{@render row(
                run,
                group.status,
              )}{/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>
</ScrollArea>
