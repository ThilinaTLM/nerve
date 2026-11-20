<!--
  Persistent notification entries for configuration that waits for the user or
  does not work, in two groups. The host computes the rows; this only draws them.
-->
<script lang="ts" module>
import type { NotificationEntryAction } from "./NotificationEntry.svelte";

export type ConfigurationAttentionRow = {
  key: string;
  group: "review" | "broken";
  title: string;
  /** Tooltip for the title: the file's path. */
  titleHint?: string;
  /** Where it comes from. */
  context: string;
  /** The diagnostic's own words. */
  detail: string;
  actions: NotificationEntryAction[];
};
</script>

<script lang="ts">
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import NotificationEntry from "./NotificationEntry.svelte";

let { rows }: { rows: readonly ConfigurationAttentionRow[] } = $props();

const groups = $derived([
  {
    id: "review",
    label: "Waiting for your review",
    tone: "attention" as const,
    rows: rows.filter((row) => row.group === "review"),
  },
  {
    id: "broken",
    label: "Not working",
    tone: "failed" as const,
    rows: rows.filter((row) => row.group === "broken"),
  },
]);
</script>

<section
  class="grid gap-0"
  aria-label="Configuration needs attention"
  data-testid="configuration-attention"
>
  {#each groups.filter((group) => group.rows.length) as group (group.id)}
    <GroupLabel
      class="px-3 pt-2"
      label={group.label}
      count={group.rows.length}
    />
    {#each group.rows as row (row.key)}
      <NotificationEntry
        tone={group.tone}
        title={row.title}
        titleHint={row.titleHint}
        context={row.context}
        detail={row.detail}
        actions={row.actions}
      />
    {/each}
  {/each}
</section>
