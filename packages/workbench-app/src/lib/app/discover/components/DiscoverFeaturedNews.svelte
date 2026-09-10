<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Card, CardContent } from "@nervekit/ui-kit/components/ui/card";
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

<Card size="sm" class="rounded-md">
  <CardContent
    class="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]"
  >
    <div class="grid min-w-0 gap-2">
      <div class="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{entry.releasedIn}</Badge>
        {#if entry.unread}
          <Badge variant="info">New</Badge>
        {/if}
      </div>
      <div class="grid gap-1">
        <h3 class="text-base font-semibold leading-tight">{entry.title}</h3>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {entry.summary}
        </p>
      </div>
      {#if entry.details?.length}
        <ul class="grid gap-1">
          {#each entry.details as detail (detail)}
            <li
              class="flex gap-1.5 text-xs leading-relaxed text-muted-foreground"
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
    {#if entry.artwork}
      <div class="hidden h-28 sm:block">
        <DiscoverNewsArtwork artwork={entry.artwork} />
      </div>
    {/if}
  </CardContent>
</Card>
