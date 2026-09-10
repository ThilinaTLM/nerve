<script lang="ts">
import type { DiscoverAction, DiscoverTipEntry } from "../content/entries.js";
import DiscoverActionButton from "./DiscoverActionButton.svelte";
import DiscoverSection from "./DiscoverSection.svelte";

type Props = {
  tips: readonly DiscoverTipEntry[];
  onAction: (action: DiscoverAction) => void;
};

let { tips, onAction }: Props = $props();
</script>

<DiscoverSection id="discover-tips-title" title="Tips">
  <div class="grid gap-2.5 sm:grid-cols-2">
    {#each tips as tip (tip.id)}
      <div class="grid content-start gap-1.5 rounded-md border bg-card p-3">
        <h3 class="text-sm text-foreground">{tip.title}</h3>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {tip.summary}
        </p>
        {#if tip.action}
          <div class="pt-0.5">
            <DiscoverActionButton
              action={tip.action}
              variant="link"
              {onAction}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>
</DiscoverSection>
