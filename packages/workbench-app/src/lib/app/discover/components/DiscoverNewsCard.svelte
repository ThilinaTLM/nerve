<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { DiscoverAction } from "../content/entries.js";
import { discoverReleaseLabel, type ResolvedNewsEntry } from "../policy.js";
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
    <div class="border-b bg-background px-3 py-2">
      <div class="mx-auto aspect-[2/1] w-full max-w-72">
        <DiscoverNewsArtwork artwork={entry.artwork} />
      </div>
    </div>
  {/if}
  <div class="grid content-between gap-3 p-3">
    <div class="grid gap-1">
      <div class="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral">{discoverReleaseLabel(entry.releasedIn)}</Badge
        >
        {#if entry.unread}
          <Badge variant="info">New</Badge>
        {/if}
      </div>
      <h3 class="pt-0.5 text-ui font-medium">{entry.title}</h3>
      <p class="text-ui text-muted-foreground">{entry.summary}</p>
    </div>
    {#if entry.action}
      <div>
        <DiscoverActionButton action={entry.action} {onAction} />
      </div>
    {/if}
  </div>
</article>
