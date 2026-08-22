<script lang="ts">
import type { GithubPrOverview } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import GithubPrSection from "./GithubPrSection.svelte";
import PrAvatar from "./PrAvatar.svelte";
import { divergenceLabel, divergenceTone, reviewTone } from "./pr-pane-helpers";

type Props = { overview: GithubPrOverview };
let { overview }: Props = $props();

const mergeableTone = $derived(
  overview.mergeable === "MERGEABLE"
    ? "good"
    : overview.mergeable === "CONFLICTING"
      ? "danger"
      : ("neutral" as const),
);
</script>

<GithubPrSection title="Overview" contentClass="flex flex-col gap-1 px-3 py-2">
  <div class="flex min-h-5 items-start gap-2">
    <span class="w-[4.5rem] shrink-0 pt-0.5 text-muted-foreground"
      >Mergeability</span
    >
    <div class="flex min-w-0 flex-wrap gap-1">
      <Badge size="xs" tone={mergeableTone}>
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
    <span class="w-[4.5rem] shrink-0 pt-0.5 text-muted-foreground"
      >Base branch</span
    >
    <Badge size="xs" tone={divergenceTone(overview)}>
      {divergenceLabel(overview)}
    </Badge>
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-[4.5rem] shrink-0 text-muted-foreground">Reviewers</span>
    {#if overview.reviewRequests.length > 0}
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {#each overview.reviewRequests as reviewer (reviewer.login)}
          <span
            class="inline-flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent/40"
            title={reviewer.login}
          >
            <PrAvatar
              name={reviewer.login}
              src={reviewer.avatarUrl}
              class="size-4"
            />
            <span class="truncate text-foreground">{reviewer.login}</span>
          </span>
        {/each}
      </div>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground">—</span>
    {/if}
  </div>

  <div class="flex min-h-5 items-start gap-2">
    <span class="w-[4.5rem] shrink-0 text-muted-foreground">Labels</span>
    {#if overview.labels.length > 0}
      <div class="flex min-w-0 flex-1 flex-wrap gap-1">
        {#each overview.labels as label (label.name)}
          <!-- GitHub-supplied label color is content, not theme chrome -->
          <Badge variant="outline" size="xs" title={label.name}>
            {#if label.color}
              <span
                class="mr-0.5 inline-block size-2 shrink-0 rounded-full"
                style={`background:#${label.color}`}
              ></span>
            {/if}
            {label.name}
          </Badge>
        {/each}
      </div>
    {:else}
      <span class="min-w-0 flex-1 text-muted-foreground">—</span>
    {/if}
  </div>
</GithubPrSection>
