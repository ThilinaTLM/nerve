<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { DiscoverAction } from "../content/entries.js";
import {
  discoverReleaseLabel,
  type DiscoverNewsSection,
  type ResolvedNewsEntry,
} from "../policy.js";
import DiscoverActionButton from "./DiscoverActionButton.svelte";
import DiscoverFeaturedNews from "./DiscoverFeaturedNews.svelte";
import DiscoverSpotlight from "./DiscoverSpotlight.svelte";
import DiscoverList from "./DiscoverList.svelte";
import DiscoverNewsCard from "./DiscoverNewsCard.svelte";
import DiscoverListRow from "./DiscoverListRow.svelte";
import DiscoverSection from "./DiscoverSection.svelte";

type Props = {
  news: DiscoverNewsSection;
  currentVersion: string | undefined;
  onAction: (action: DiscoverAction) => void;
};

let { news, currentVersion, onAction }: Props = $props();

let archiveOpen = $state(false);

// Illustrated cards fill the grid; text-only notes (fixes, small changes)
// follow as compact full-width rows. Pick the column count that leaves no
// orphan cell when the card count allows it.
function gridColumns(count: number): string {
  if (count === 2 || count === 4) return "@xl:grid-cols-2";
  return "@xl:grid-cols-2 @3xl:grid-cols-3";
}

const empty = $derived(!news.spotlight && news.releases.length === 0);
</script>

{#snippet newsRow(entry: ResolvedNewsEntry)}
  <DiscoverListRow
    title={entry.title}
    description={entry.summary}
    unread={entry.unread}
  >
    {#snippet meta()}
      <Badge variant="neutral">{discoverReleaseLabel(entry.releasedIn)}</Badge>
    {/snippet}
    {#snippet actions()}
      {#if entry.action}
        <DiscoverActionButton action={entry.action} {onAction} />
      {/if}
    {/snippet}
  </DiscoverListRow>
{/snippet}

<DiscoverSection id="discover-news-title" title="What's new">
  {#snippet trailing()}
    {#if news.unreadCount > 0}
      <Badge variant="info">{news.unreadCount} new</Badge>
    {/if}
  {/snippet}

  <div class="grid gap-5">
    {#if news.spotlight}
      <DiscoverSpotlight entry={news.spotlight} {onAction} />
    {/if}

    {#each news.releases as group (group.release)}
      {@const cards = group.entries.filter((entry) => entry.artwork)}
      {@const notes = group.entries.filter((entry) => !entry.artwork)}
      <section
        class="grid gap-2.5"
        aria-labelledby={`discover-release-${group.release}`}
      >
        <div class="flex items-center gap-3">
          <h3
            id={`discover-release-${group.release}`}
            class="shrink-0 text-caption font-medium uppercase tracking-wide text-muted-foreground"
          >
            {group.label}
          </h3>
          <div class="h-px flex-1 bg-border" aria-hidden="true"></div>
        </div>
        <div class={["grid gap-2.5", gridColumns(cards.length)]}>
          {#if group.featured}
            <DiscoverFeaturedNews entry={group.featured} {onAction} />
          {/if}
          {#each cards as entry (entry.id)}
            <DiscoverNewsCard {entry} {onAction} />
          {/each}
        </div>
        {#if notes.length > 0}
          <DiscoverList>
            {#each notes as entry (entry.id)}
              {@render newsRow(entry)}
            {/each}
          </DiscoverList>
        {/if}
      </section>
    {/each}

    {#if empty}
      <p class="text-ui text-muted-foreground">
        {currentVersion
          ? `Nothing new since ${currentVersion}.`
          : "Nothing new right now."}
      </p>
    {/if}

    {#if news.archive.length > 0}
      <DiscoverList>
        <div class="px-1 py-1">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (archiveOpen = !archiveOpen)}
            aria-expanded={archiveOpen}
          >
            {#if archiveOpen}
              <ChevronDown class="size-3.5" aria-hidden="true" />
            {:else}
              <ChevronRight class="size-3.5" aria-hidden="true" />
            {/if}
            {archiveOpen
              ? "Hide earlier updates"
              : `Show ${news.archive.length} earlier updates`}
          </Button>
        </div>

        {#if archiveOpen}
          {#each news.archive as entry (entry.id)}
            {@render newsRow(entry)}
          {/each}
        {/if}
      </DiscoverList>
    {/if}
  </div>
</DiscoverSection>
