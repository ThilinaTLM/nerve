<!--
  "What it can do": the daemon's plain-language items for one reviewed item.
  Broad items first with a warning icon; items the user has not approved
  before carry a New badge.
-->
<script lang="ts">
import type { ConfigurationReviewItem } from "@nervekit/contracts/configuration";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { orderedReviewItems } from "./review-format";
import ReviewText from "./ReviewText.svelte";

let {
  items,
  /** Marks broad items in warning tone; off once the item is trusted. */
  highlight = true,
}: {
  items: readonly ConfigurationReviewItem[];
  highlight?: boolean;
} = $props();

const ordered = $derived(orderedReviewItems(items));
</script>

{#if ordered.length}
  <ul class="grid gap-1" aria-label="What it can do">
    {#each ordered as item, index (index)}
      <li class="flex items-start gap-2 text-ui">
        <span class="flex h-5 w-3.5 flex-none items-center justify-center">
          {#if item.broad}
            <TriangleAlert
              class={highlight
                ? "size-3.5 text-warning"
                : "size-3.5 text-muted-foreground"}
              aria-label="Broad"
            />
          {:else}
            <span
              class="size-1 rounded-full bg-muted-foreground"
              aria-hidden="true"
            ></span>
          {/if}
        </span>
        <span class="min-w-0 flex-1 leading-5"
          ><ReviewText text={item.text} /></span
        >
        {#if item.new}<Badge variant="info">New</Badge>{/if}
      </li>
    {/each}
  </ul>
{:else}
  <p class="text-ui text-muted-foreground">Nothing to report.</p>
{/if}
