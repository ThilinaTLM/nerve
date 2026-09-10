<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { DiscoverAction } from "../content/entries.js";
import type { DiscoverNewsSection, ResolvedNewsEntry } from "../policy.js";
import DiscoverActionButton from "./DiscoverActionButton.svelte";
import DiscoverFeaturedNews from "./DiscoverFeaturedNews.svelte";
import DiscoverList from "./DiscoverList.svelte";
import DiscoverListRow from "./DiscoverListRow.svelte";
import DiscoverSection from "./DiscoverSection.svelte";

type Props = {
  news: DiscoverNewsSection;
  currentVersion: string | undefined;
  onAction: (action: DiscoverAction) => void;
};

let { news, currentVersion, onAction }: Props = $props();

let archiveOpen = $state(false);

const empty = $derived(!news.featured && news.current.length === 0);
</script>

{#snippet newsRow(entry: ResolvedNewsEntry)}
  <DiscoverListRow
    title={entry.title}
    description={entry.summary}
    unread={entry.unread}
  >
    {#snippet meta()}
      <Badge variant="outline">{entry.releasedIn}</Badge>
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

  <div class="grid gap-2.5">
    {#if news.featured}
      <DiscoverFeaturedNews entry={news.featured} {onAction} />
    {/if}

    {#if news.current.length > 0 || empty || news.archive.length > 0}
      <DiscoverList>
        {#each news.current as entry (entry.id)}
          {@render newsRow(entry)}
        {/each}

        {#if empty}
          <p class="px-3 py-2.5 text-xs text-muted-foreground">
            {currentVersion
              ? `Nothing new since ${currentVersion}.`
              : "Nothing new right now."}
          </p>
        {/if}

        {#if news.archive.length > 0}
          <div class="px-1 py-1">
            <Button
              variant="ghost"
              size="xs"
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
        {/if}

        {#if archiveOpen}
          {#each news.archive as entry (entry.id)}
            {@render newsRow(entry)}
          {/each}
        {/if}
      </DiscoverList>
    {/if}
  </div>
</DiscoverSection>
