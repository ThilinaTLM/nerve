<script lang="ts">
  import type { ConfluenceIncludedCountsPayload } from "@nervekit/shared";

  type Props = { counts: ConfluenceIncludedCountsPayload };
  let { counts }: Props = $props();

  // Fixed render order with friendly labels.
  const ORDER: Array<[keyof ConfluenceIncludedCountsPayload, string]> = [
    ["versions", "Versions"],
    ["attachments", "Attachments"],
    ["downloadedAttachments", "Downloaded"],
    ["labels", "Labels"],
    ["properties", "Properties"],
    ["directChildren", "Children"],
    ["operations", "Operations"],
    ["pages", "Pages"],
    ["spaces", "Spaces"],
  ];

  const metrics = $derived(
    ORDER.flatMap(([key, label]) => {
      const value = counts[key];
      return typeof value === "number" ? [{ label, value }] : [];
    }),
  );
</script>

{#if metrics.length > 0}
  <div class="flex flex-wrap gap-1.5">
    {#each metrics as metric (metric.label)}
      <span class="inline-flex items-center gap-1.5 rounded-sm border bg-sidebar px-2 py-1 text-xs">
        <span class="font-semibold tabular-nums text-sidebar-foreground">{metric.value.toLocaleString()}</span>
        <span class="text-muted-foreground">{metric.label}</span>
      </span>
    {/each}
  </div>
{/if}
