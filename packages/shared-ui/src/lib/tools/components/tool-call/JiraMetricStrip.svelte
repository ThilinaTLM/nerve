<script lang="ts">
  import type { JiraIncludedCountsPayload } from "@nervekit/shared";

  type Props = { counts: JiraIncludedCountsPayload };
  let { counts }: Props = $props();

  // Fixed render order with friendly labels.
  const ORDER: Array<[keyof JiraIncludedCountsPayload, string]> = [
    ["comments", "Comments"],
    ["transitions", "Transitions"],
    ["statuses", "Statuses"],
    ["components", "Components"],
    ["versions", "Versions"],
    ["issueTypes", "Issue types"],
    ["fields", "Fields"],
    ["priorities", "Priorities"],
    ["resolutions", "Resolutions"],
    ["worklogs", "Worklogs"],
    ["changelog", "Changelog"],
    ["remoteLinks", "Remote links"],
    ["attachments", "Attachments"],
    ["editmetaFields", "Edit fields"],
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
