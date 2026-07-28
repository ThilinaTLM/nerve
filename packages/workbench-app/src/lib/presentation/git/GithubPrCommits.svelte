<script lang="ts">
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import type { GithubPrDetail } from "@nervekit/contracts";
import GithubPrSection from "./GithubPrSection.svelte";
import { formatPrDate } from "./pr-pane-helpers";

type Props = { detail: GithubPrDetail };
let { detail }: Props = $props();
</script>

<GithubPrSection
  title={`${detail.commits.length} ${detail.commits.length === 1 ? "commit" : "commits"}`}
  contentClass="p-0"
>
  {#if detail.commits.length === 0}
    <p class="px-3 py-3 text-xs text-muted-foreground">
      No commit data available.
    </p>
  {:else}
    <ol class="divide-y divide-border/60">
      {#each detail.commits as commit (commit.oid)}
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
          <code class="shrink-0 rounded bg-muted px-1 py-0.5 font-mono"
            >{commit.abbrev}</code
          >
        </li>
      {/each}
    </ol>
  {/if}
</GithubPrSection>
