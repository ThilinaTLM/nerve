<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { DiscoverAction } from "../content/entries.js";
import type { ResolvedNewsEntry } from "../policy.js";
import DiscoverActionButton from "./DiscoverActionButton.svelte";
import DiscoverNewsArtwork from "./DiscoverNewsArtwork.svelte";

type Props = {
  entry: ResolvedNewsEntry;
  onAction: (action: DiscoverAction) => void;
};

let { entry, onAction }: Props = $props();
</script>

<article
  class="grid grid-rows-[auto_1fr] overflow-hidden rounded-md bg-card text-card-foreground ring-1 ring-border"
>
  {#if entry.artwork}
    <div class="h-28 border-b bg-background">
      <DiscoverNewsArtwork artwork={entry.artwork} />
    </div>
  {/if}
  <div class="grid content-between gap-3 p-3">
    <div class="grid gap-1">
      <div class="flex items-center gap-1.5">
        <h3 class="text-ui font-medium">{entry.title}</h3>
        {#if entry.unread}
          <Badge variant="info">New</Badge>
        {/if}
      </div>
      <p class="text-ui text-muted-foreground">{entry.summary}</p>
    </div>
    {#if entry.action}
      <div>
        <DiscoverActionButton action={entry.action} {onAction} />
      </div>
    {/if}
  </div>
</article>
