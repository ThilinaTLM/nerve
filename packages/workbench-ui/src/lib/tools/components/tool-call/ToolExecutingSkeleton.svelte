<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";

type Props = {
  /** `list` mimics result rows/cards; `text` mimics a code/output block. */
  variant?: "list" | "text";
  rows?: number;
};

let { variant = "list", rows = 3 }: Props = $props();

const bars = $derived(Array.from({ length: Math.max(1, rows) }, (_, i) => i));
</script>

<!-- Placeholder silhouette for result cards while a tool call executes. -->
{#if variant === "text"}
  <div
    class="grid gap-1.5 rounded-sm border border-border bg-sidebar p-2.5"
    aria-hidden="true"
  >
    {#each bars as bar (bar)}
      <Skeleton class={bar % 2 === 0 ? "h-3 w-full" : "h-3 w-2/3"} />
    {/each}
  </div>
{:else}
  <div class="grid gap-1.5" aria-hidden="true">
    {#each bars as bar (bar)}
      <Skeleton class="h-9 w-full rounded-sm" />
    {/each}
  </div>
{/if}
