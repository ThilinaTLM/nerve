<script lang="ts">
import type { GithubPrOverview } from "@nervekit/contracts/git";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import GitHubPrSection from "./GitHubPrSection.svelte";
import { divergenceLabel, divergenceTone, reviewTone } from "./pr-pane-helpers";

type Props = { overview: GithubPrOverview };
let { overview }: Props = $props();
</script>

<GitHubPrSection
  title="Overview"
  contentClass="flex flex-col gap-1.5 px-3 py-2.5"
>
  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 pt-0.5 text-muted-foreground">Mergeability</span>
    <div class="flex min-w-0 flex-wrap gap-1">
      <Badge
        size="xs"
        tone={overview.mergeable === "MERGEABLE"
          ? "good"
          : overview.mergeable === "CONFLICTING"
            ? "danger"
            : "neutral"}
      >
        {overview.mergeable?.toLowerCase() ?? "calculating"}
      </Badge>
      {#if overview.reviewDecision}
        <Badge size="xs" tone={reviewTone(overview.reviewDecision)}>
          {overview.reviewDecision.replaceAll("_", " ").toLowerCase()}
        </Badge>
      {/if}
    </div>
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 pt-0.5 text-muted-foreground">Base branch</span>
    <div class="flex min-w-0 flex-wrap gap-1">
      <Badge size="xs" tone={divergenceTone(overview)}>
        {divergenceLabel(overview)}
      </Badge>
    </div>
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 text-muted-foreground">Reviewers</span>
    {#if overview.reviewRequests.length > 0}
      <span class="min-w-0 flex-1 text-foreground">
        {overview.reviewRequests.map((reviewer) => reviewer.login).join(", ")}
      </span>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground"
        >No pending review requests</span
      >
    {/if}
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 text-muted-foreground">Labels</span>
    {#if overview.labels.length > 0}
      <div class="flex min-w-0 flex-1 flex-wrap gap-1">
        {#each overview.labels as label (label.name)}
          <Badge variant="outline" size="xs">{label.name}</Badge>
        {/each}
      </div>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground">No labels</span>
    {/if}
  </div>
</GitHubPrSection>
