<!--
  "Source": the files a decision covers, as paths that open in Nerve's file
  viewer. Never their content. Scripts are marked and listed first. Long
  lists show the first few rows and expand on request.
-->
<script lang="ts">
import type { ConfigurationReviewSource } from "@nervekit/contracts/configuration";
import ExternalLink from "@lucide/svelte/icons/external-link";
import FileCode from "@lucide/svelte/icons/file-code";
import FileText from "@lucide/svelte/icons/file-text";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";

/** Lists up to this many rows show in full; longer ones collapse to `PREVIEW`. */
const COLLAPSE_AFTER = 6;
const PREVIEW = 4;

let {
  sources,
  onOpen,
  /** Marks scripts in warning tone; off once the item is trusted. */
  highlight = true,
}: {
  sources: readonly ConfigurationReviewSource[];
  /** Opens one file by absolute path; without it the rows are plain text. */
  onOpen?: (path: string) => void;
  highlight?: boolean;
} = $props();

let expanded = $state(false);

/** Scripts first: they are what a decision lets run. */
const ordered = $derived(
  [...sources].sort((a, b) => Number(!!b.script) - Number(!!a.script)),
);
const collapsible = $derived(ordered.length > COLLAPSE_AFTER);
const shown = $derived(
  collapsible && !expanded ? ordered.slice(0, PREVIEW) : ordered,
);
const rowClass =
  "group flex h-7 w-full min-w-0 items-center gap-2 px-2.5 text-left";
</script>

<div
  class="min-w-0 divide-y divide-border rounded-md border bg-card"
  role="list"
  aria-label="Source"
>
  {#each shown as source (source.path)}
    {@const Icon = source.script ? FileCode : FileText}
    <div role="listitem">
      {#snippet row()}
        <Icon
          class="size-3.5 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate font-mono text-ui"
          >{source.label}</span
        >
        {#if source.script}<Badge variant={highlight ? "warning" : "neutral"}
            >Script</Badge
          >{/if}
      {/snippet}
      {#if onOpen}
        <button
          type="button"
          class="{rowClass} hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
          title={`Open ${source.path}`}
          aria-label={`Open ${source.label}`}
          onclick={() => onOpen(source.path)}
        >
          {@render row()}
          <ExternalLink
            class="size-3.5 flex-none text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        </button>
      {:else}
        <div class={rowClass} title={source.path}>{@render row()}</div>
      {/if}
    </div>
  {:else}
    <p class="px-2.5 py-1.5 text-ui text-muted-foreground">No files.</p>
  {/each}
  {#if collapsible}
    <button
      type="button"
      class="flex h-7 w-full items-center px-2.5 text-left text-ui text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:bg-hover focus-visible:outline-none"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      {expanded
        ? "Show fewer"
        : `Show ${ordered.length - PREVIEW} more ${ordered.length - PREVIEW === 1 ? "file" : "files"}`}
    </button>
  {/if}
</div>
