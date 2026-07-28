<script lang="ts">
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import type { GithubPrDetail } from "@nervekit/contracts";
import { formatPrDate } from "./pr-pane-helpers";

type Props = { detail: GithubPrDetail };
let { detail }: Props = $props();
</script>

<div class="mx-auto max-w-4xl">
  <h2 class="mb-3 text-sm font-semibold">
    {detail.commits.length}
    {detail.commits.length === 1 ? "commit" : "commits"}
  </h2>
  {#if detail.commits.length === 0}
    <p
      class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
    >
      No commit data available.
    </p>
  {:else}
    <ol class="divide-y rounded-md border bg-card">
      {#each detail.commits as commit (commit.oid)}
        <li class="flex items-start gap-3 px-4 py-3">
          <GitCommitHorizontal
            class="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{commit.messageHeadline}</p>
            <p class="mt-1 text-xs text-muted-foreground">
              {commit.authorName ?? "Unknown author"}
              {#if commit.authoredDate}
                · {formatPrDate(commit.authoredDate)}{/if}
            </p>
          </div>
          <code class="rounded border bg-muted px-1.5 py-0.5 text-xs"
            >{commit.abbrev}</code
          >
        </li>
      {/each}
    </ol>
  {/if}
</div>
