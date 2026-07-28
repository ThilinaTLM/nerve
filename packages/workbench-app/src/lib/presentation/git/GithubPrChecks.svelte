<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import ExternalLink from "@lucide/svelte/icons/external-link";
import X from "@lucide/svelte/icons/x";
import type { GithubPrDetail } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { checksTone, runTone } from "./pr-pane-helpers";

type Props = { detail: GithubPrDetail };
let { detail }: Props = $props();
</script>

<div class="mx-auto max-w-4xl space-y-4">
  <div class="flex items-center justify-between rounded-md border bg-card p-4">
    <div>
      <h2 class="font-semibold">Checks</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {detail.checks.passed} passed, {detail.checks.failed} failed,
        {detail.checks.pending} pending
      </p>
    </div>
    <Badge tone={checksTone(detail.checks)}>
      {#if detail.checks.status === "passing"}
        <Check class="size-3" />
      {:else if detail.checks.status === "failing"}
        <X class="size-3" />
      {:else if detail.checks.status === "pending"}
        <Spinner class="size-3" />
      {:else}
        <CircleDot class="size-3" />
      {/if}
      {detail.checks.status === "none" ? "No checks" : detail.checks.status}
    </Badge>
  </div>

  {#if detail.checks.runs.length === 0}
    <p
      class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
    >
      No checks have been reported.
    </p>
  {:else}
    <ul class="divide-y rounded-md border bg-card" aria-label="Check runs">
      {#each detail.checks.runs as run (`${run.name}:${run.url ?? ""}`)}
        <li class="flex items-center gap-3 px-4 py-3">
          <Badge tone={runTone(run.status)} size="xs"
            >{run.status.toLowerCase()}</Badge
          >
          <span class="min-w-0 flex-1 truncate text-sm font-medium"
            >{run.name}</span
          >
          {#if run.url}
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              class="text-muted-foreground hover:text-foreground"
              aria-label={`Open ${run.name} on GitHub`}
            >
              <ExternalLink class="size-4" />
            </a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
