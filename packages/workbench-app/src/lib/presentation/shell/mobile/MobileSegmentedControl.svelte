<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";

export type MobileSegment = {
  id: string;
  label: string;
  /** Count badge; hidden when undefined. */
  count?: number;
  /** `warning` tints the badge for counts that ask for attention. */
  tone?: "warning";
};

/**
 * Equal-width view switcher under a phone screen header: a muted track with
 * the selected segment raised on a card surface. Touch-sized (44px).
 */
let {
  items,
  value,
  label,
  onSelect,
}: {
  items: MobileSegment[];
  value: string;
  label: string;
  onSelect: (id: string) => void;
} = $props();
</script>

<div
  role="tablist"
  aria-label={label}
  class="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-muted p-0.5"
>
  {#each items as item (item.id)}
    {@const selected = item.id === value}
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      class={cn(
        "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-sm text-ui",
        selected
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground active:bg-hover",
      )}
      onclick={() => onSelect(item.id)}
    >
      <span class="truncate">{item.label}</span>
      {#if item.count !== undefined}
        <span
          class={cn(
            "rounded-full px-1.5 text-caption tabular-nums",
            item.tone === "warning"
              ? "bg-warning-subtle text-warning"
              : "bg-hover text-muted-foreground",
          )}>{item.count}</span
        >
      {/if}
    </button>
  {/each}
</div>
