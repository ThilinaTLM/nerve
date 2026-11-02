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
  class="col-span-full grid overflow-hidden rounded-md bg-card text-body text-card-foreground ring-1 ring-border @xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]"
>
  {#if entry.artwork}
    <div
      class="flex items-center justify-center border-b bg-background px-5 py-4 @xl:order-last @xl:border-b-0 @xl:border-l"
    >
      <div class="aspect-[2/1] w-full max-w-sm">
        <DiscoverNewsArtwork artwork={entry.artwork} />
      </div>
    </div>
  {/if}
  <div class="grid min-w-0 content-center gap-2 p-4">
    <div class="flex flex-wrap items-center gap-1.5">
      <Badge variant="neutral">{discoverReleaseLabel(entry.releasedIn)}</Badge>
      {#if entry.unread}
        <Badge variant="info">New</Badge>
      {/if}
    </div>
    <div class="grid gap-1">
      <h3 class="text-title font-semibold leading-tight">{entry.title}</h3>
      <p class="text-ui leading-relaxed text-muted-foreground">
        {entry.summary}
      </p>
    </div>
    {#if entry.details?.length}
      <ul class="grid gap-1">
        {#each entry.details as detail (detail)}
          <li
            class="flex gap-1.5 text-ui leading-relaxed text-muted-foreground"
          >
            <span aria-hidden="true">·</span>
            <span>{detail}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if entry.action}
      <div class="pt-0.5">
        <DiscoverActionButton action={entry.action} {onAction} />
      </div>
    {/if}
  </div>
</article>
