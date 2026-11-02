<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Sparkles from "@lucide/svelte/icons/sparkles";
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

<!-- The headline feature of the newest release: large artwork, full story. -->
<article
  class="grid overflow-hidden rounded-md bg-card text-card-foreground ring-1 ring-border @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
  aria-labelledby={`discover-spotlight-${entry.id}`}
>
  {#if entry.artwork}
    <div
      class="flex items-center justify-center border-b bg-background px-6 py-5 @2xl:order-last @2xl:border-b-0 @2xl:border-l"
    >
      <div class="aspect-[2/1] w-full max-w-md">
        <DiscoverNewsArtwork artwork={entry.artwork} />
      </div>
    </div>
  {/if}
  <div class="grid content-center gap-3 p-5">
    <div class="flex flex-wrap items-center gap-1.5">
      <Badge variant="info">
        <Sparkles class="size-3" aria-hidden="true" />
        {discoverReleaseLabel(entry.releasedIn)}
      </Badge>
      {#if entry.unread}
        <Badge variant="neutral">New</Badge>
      {/if}
    </div>
    <div class="grid gap-1.5">
      <h3
        id={`discover-spotlight-${entry.id}`}
        class="text-title font-semibold leading-tight"
      >
        {entry.title}
      </h3>
      <p class="text-body leading-relaxed text-muted-foreground">
        {entry.summary}
      </p>
    </div>
    {#if entry.details?.length}
      <ul class="grid gap-1.5">
        {#each entry.details as detail (detail)}
          <li class="flex gap-2 text-ui leading-relaxed text-muted-foreground">
            <Check
              class="mt-0.5 size-3.5 shrink-0 text-success"
              aria-hidden="true"
            />
            <span>{detail}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if entry.action}
      <div class="pt-1">
        <DiscoverActionButton
          action={entry.action}
          variant="default"
          {onAction}
        />
      </div>
    {/if}
  </div>
</article>
