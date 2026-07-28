<script lang="ts">
import type { GithubPrDetail } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import GithubPrSection from "./GithubPrSection.svelte";
import { divergenceLabel, divergenceTone, reviewTone } from "./pr-pane-helpers";

type Props = { detail: GithubPrDetail };
let { detail }: Props = $props();
</script>

<GithubPrSection
  title="Overview"
  contentClass="flex flex-col gap-1.5 px-3 py-2.5"
>
  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 pt-0.5 text-muted-foreground">Mergeability</span>
    <div class="flex min-w-0 flex-wrap gap-1">
      <Badge
        size="xs"
        tone={detail.mergeable === "MERGEABLE"
          ? "good"
          : detail.mergeable === "CONFLICTING"
            ? "danger"
            : "neutral"}
      >
        {detail.mergeable?.toLowerCase() ?? "calculating"}
      </Badge>
      {#if detail.reviewDecision}
        <Badge size="xs" tone={reviewTone(detail.reviewDecision)}>
          {detail.reviewDecision.replaceAll("_", " ").toLowerCase()}
        </Badge>
      {/if}
    </div>
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 pt-0.5 text-muted-foreground">Base branch</span>
    <div class="flex min-w-0 flex-wrap gap-1">
      <Badge size="xs" tone={divergenceTone(detail)}>
        {divergenceLabel(detail)}
      </Badge>
    </div>
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 text-muted-foreground">Reviewers</span>
    {#if detail.reviewRequests.length > 0}
      <span class="min-w-0 flex-1 text-foreground">
        {detail.reviewRequests.map((reviewer) => reviewer.login).join(", ")}
      </span>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground"
        >No pending review requests</span
      >
    {/if}
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-20 shrink-0 text-muted-foreground">Labels</span>
    {#if detail.labels.length > 0}
      <div class="flex min-w-0 flex-1 flex-wrap gap-1">
        {#each detail.labels as label (label.name)}
          <Badge variant="outline" size="xs">{label.name}</Badge>
        {/each}
      </div>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground">No labels</span>
    {/if}
  </div>
</GithubPrSection>
