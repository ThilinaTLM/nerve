<!--
  "What it can do" and "Source" for one item on its Settings page, read from
  `configuration.review`. Pass `item` to share the review with the page's own
  decision callout; otherwise the sections read it themselves.
-->
<script lang="ts">
import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import type { ConfigurationItemReview } from "$lib/application/configuration-review/configuration-item-review.svelte";
import ConfigurationReviewSections from "$lib/presentation/configuration-review/ConfigurationReviewSections.svelte";
import { useItemReview } from "./item-review.svelte";

let {
  target,
  item,
  source = true,
  onOpenSource,
}: {
  target: ConfigurationReviewTarget;
  item?: ConfigurationItemReview;
  /** Off where the page has its own Source section (MCP servers). */
  source?: boolean;
  onOpenSource?: (path: string) => void;
} = $props();

const own = useItemReview(() => (item ? undefined : target));
const state = $derived(item ?? own.current);
</script>

{#if state?.review}
  <ConfigurationReviewSections review={state.review} {source} {onOpenSource} />
{:else if state?.phase === "loading"}
  <Skeleton class="h-24 w-full" />
{:else if state?.error}
  <Callout
    tone="neutral"
    text={`Could not read what it can do: ${state.error}`}
  />
{/if}
