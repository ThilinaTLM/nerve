<!--
  The review of one item on its Settings page: "What it can do" and "Source",
  the same two sections as the review dialog. Paths open in Nerve's file
  viewer; content is never inlined.
-->
<script lang="ts">
import type { ConfigurationReview } from "@nervekit/contracts/configuration";
import SettingsSection from "$lib/presentation/settings/SettingsSection.svelte";
import ReviewCapabilityList from "./ReviewCapabilityList.svelte";
import ReviewSourceList from "./ReviewSourceList.svelte";

let {
  review,
  source = true,
  onOpenSource,
}: {
  review: ConfigurationReview;
  /** Off where the page has its own Source section. */
  source?: boolean;
  /** Opens one source file by absolute path. */
  onOpenSource?: (path: string) => void;
} = $props();

const highlight = $derived(review.state !== "trusted");
</script>

<SettingsSection
  title="What it can do"
  description={review.state === "trusted"
    ? "What you trusted. A change outside Nerve asks you again."
    : "What it changes for agents once you trust it."}
>
  <ReviewCapabilityList items={review.items} {highlight} />
</SettingsSection>

{#if source}
  <SettingsSection
    title="Source"
    description="Trust covers exactly these files."
    surface={false}
  >
    <ReviewSourceList
      sources={review.sources}
      onOpen={onOpenSource}
      {highlight}
    />
  </SettingsSection>
{/if}
