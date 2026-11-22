<!--
  The one warning at the top of a layered page while the project's settings
  file is not trusted: its column is locked and the project uses User's values.
  Review opens the Trust page.
-->
<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let { onReview }: { onReview: () => void } = $props();
</script>

<Callout
  layout="block"
  tone="warning"
  icon={ShieldCheck}
  title="This project's settings file isn't trusted yet"
  text="Until you review it, the project uses your settings and its column is locked."
>
  {#snippet actions()}
    <Button size="sm" variant="outline" onclick={onReview}>Review</Button>
  {/snippet}
</Callout>
