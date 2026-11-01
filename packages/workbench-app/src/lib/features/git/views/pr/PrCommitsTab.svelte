<script lang="ts">
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import type { GithubPrCommitsResponse } from "@nervekit/contracts/git";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import {
  formatPrDateCompact,
  formatRelativeAge,
  groupCommitsByDay,
} from "../pr-pane-helpers";
import PrAvatar from "./PrAvatar.svelte";
import PrTooltip from "./PrTooltip.svelte";

type Props = { response: GithubPrCommitsResponse };
let { response }: Props = $props();
const days = $derived(groupCommitsByDay(response.commits));
</script>

<ScrollArea class="h-full" viewportClass="@container">
  <div class="flex max-w-3xl flex-col gap-5 px-4 py-4">
    {#each days as group (group.day)}
      <section aria-label={group.day}>
        <h2 class="mb-1.5 text-ui font-medium text-muted-foreground">
          {group.day}
        </h2>
        <ol class="divide-y overflow-hidden rounded-md border bg-card">
          {#each group.commits as commit (commit.oid)}
            {@const author = commit.authorLogin ?? commit.authorName}
            <li class="flex items-center gap-3 px-3 py-2 hover:bg-hover">
              <GitCommitHorizontal
                class="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-ui" title={commit.messageHeadline}>
                  {commit.messageHeadline}
                </p>
                <p
                  class="mt-0.5 flex items-center gap-1.5 text-ui text-muted-foreground"
                >
                  <PrAvatar name={author} />
                  {author ?? "Unknown author"}
                  {#if commit.authoredDate}
                    ·
                    <PrTooltip label={formatPrDateCompact(commit.authoredDate)}>
                      {formatRelativeAge(commit.authoredDate)}
                    </PrTooltip>
                  {/if}
                </p>
              </div>
              {#if commit.additions !== undefined && commit.deletions !== undefined}
                <span
                  class="hidden shrink-0 gap-1.5 text-ui tabular-nums @xl:flex"
                >
                  <span class="text-success">+{commit.additions}</span>
                  <span class="text-destructive">−{commit.deletions}</span>
                </span>
              {/if}
              <code
                class="shrink-0 rounded-sm bg-muted px-1 font-mono text-ui text-muted-foreground"
                >{commit.abbrev}</code
              >
            </li>
          {/each}
        </ol>
      </section>
    {:else}
      <p class="text-ui text-muted-foreground">No commit data available.</p>
    {/each}
  </div>
</ScrollArea>
