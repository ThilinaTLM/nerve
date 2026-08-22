<script lang="ts">
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import type { GithubPrCommitsResponse } from "@nervekit/contracts";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import GithubPrSection from "./GithubPrSection.svelte";
import { formatPrDate } from "./pr-pane-helpers";

type Props = { response: GithubPrCommitsResponse };
let { response }: Props = $props();

function copySha(abbrev: string) {
  navigator.clipboard
    .writeText(abbrev)
    .then(() => notifyCopyResult(true, "commit SHA"))
    .catch(() => notifyCopyResult(false, "commit SHA"));
}
</script>

<GithubPrSection
  title={`${response.commits.length} ${response.commits.length === 1 ? "commit" : "commits"}`}
  contentClass="p-0"
>
  {#if response.commits.length === 0}
    <p class="px-3 py-2 text-xs text-muted-foreground">
      No commit data available.
    </p>
  {:else}
    <ol class="divide-y divide-border/50">
      {#each response.commits as commit (commit.oid)}
        <li class="flex min-w-0 items-center gap-2 px-3 py-1.5">
          <GitCommitHorizontal
            class="size-3.5 shrink-0 text-muted-foreground"
          />
          <span
            class="min-w-0 flex-1 truncate font-medium text-foreground"
            title={commit.messageHeadline}
          >
            {commit.messageHeadline}
          </span>
          <span class="shrink-0 truncate text-muted-foreground">
            {commit.authorName ?? "Unknown author"}{#if commit.authoredDate}
              · {formatPrDate(commit.authoredDate)}{/if}
          </span>
          <button
            type="button"
            class="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            title="Copy commit SHA"
            aria-label={`Copy commit SHA ${commit.abbrev}`}
            onclick={() => copySha(commit.abbrev)}
          >
            {commit.abbrev}
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</GithubPrSection>
