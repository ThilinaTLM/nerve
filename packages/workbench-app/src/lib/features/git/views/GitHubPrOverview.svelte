<script lang="ts">
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitMerge from "@lucide/svelte/icons/git-merge";
import Tag from "@lucide/svelte/icons/tag";
import Users from "@lucide/svelte/icons/users";
import type { GithubPrOverview } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import GitHubPrSection from "./GitHubPrSection.svelte";
import { divergenceLabel, divergenceTone, reviewTone } from "./pr-pane-helpers";

type Props = {
  overview: GithubPrOverview;
  /** Mergeability only means something while the pull request is open. */
  open: boolean;
};
let { overview, open }: Props = $props();

const mergeableTone = $derived(
  overview.mergeable === "MERGEABLE"
    ? "success"
    : overview.mergeable === "CONFLICTING"
      ? "destructive"
      : "neutral",
);
const mergeableLabel = $derived(
  overview.mergeable === "MERGEABLE"
    ? "No conflicts"
    : overview.mergeable === "CONFLICTING"
      ? "Conflicts with base"
      : "Calculating mergeability",
);
</script>

<GitHubPrSection contentClass="flex flex-col gap-2.5 px-3 py-2.5">
  <!-- Grouped facts, each with its own icon, instead of a label/value table. -->
  {#if open}
    <div class="flex flex-col gap-1.5">
      <div class="flex min-w-0 items-center gap-2">
        <GitMerge class="size-3.5 shrink-0 text-muted-foreground" />
        <Badge variant={mergeableTone}>{mergeableLabel}</Badge>
        {#if overview.reviewDecision}
          <Badge variant={reviewTone(overview.reviewDecision)}>
            {overview.reviewDecision.replaceAll("_", " ").toLowerCase()}
          </Badge>
        {/if}
      </div>
      <div class="flex min-w-0 items-center gap-2">
        <GitBranch class="size-3.5 shrink-0 text-muted-foreground" />
        <Badge variant={divergenceTone(overview)}>
          {divergenceLabel(overview)}
        </Badge>
      </div>
    </div>
  {/if}

  <div class="flex min-w-0 items-start gap-2">
    <Users class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    {#if overview.reviewRequests.length > 0}
      <div class="flex min-w-0 flex-1 flex-wrap gap-1">
        {#each overview.reviewRequests as reviewer (reviewer.login)}
          <Badge variant="neutral">{reviewer.login}</Badge>
        {/each}
      </div>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground"
        >No review requests</span
      >
    {/if}
  </div>

  <div class="flex min-w-0 items-start gap-2">
    <Tag class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    {#if overview.labels.length > 0}
      <div class="flex min-w-0 flex-1 flex-wrap gap-1">
        {#each overview.labels as label (label.name)}
          <Badge variant="outline">{label.name}</Badge>
        {/each}
      </div>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground">No labels</span>
    {/if}
  </div>
</GitHubPrSection>
