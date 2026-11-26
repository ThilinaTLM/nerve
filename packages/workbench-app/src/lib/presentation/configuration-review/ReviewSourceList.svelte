<!--
  "Source": the files a decision covers, as paths that open in Nerve's file
  viewer. Never their content. Scripts are marked.
-->
<script lang="ts">
import type { ConfigurationReviewSource } from "@nervekit/contracts/configuration";
import FileCode from "@lucide/svelte/icons/file-code";
import FileText from "@lucide/svelte/icons/file-text";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let {
  sources,
  onOpen,
  /** Marks scripts in warning tone; off once the item is trusted. */
  highlight = true,
}: {
  sources: readonly ConfigurationReviewSource[];
  /** Opens one file by absolute path; without it the rows have no Open. */
  onOpen?: (path: string) => void;
  highlight?: boolean;
} = $props();

/** Scripts first: they are what a decision lets run. */
const ordered = $derived(
  [...sources].sort((a, b) => Number(!!b.script) - Number(!!a.script)),
);
</script>

<div
  class="min-w-0 divide-y divide-border rounded-md border bg-card"
  role="list"
  aria-label="Source"
>
  {#each ordered as source (source.path)}
    {@const Icon = source.script ? FileCode : FileText}
    <div
      class="flex min-h-9 items-center gap-2 py-1 pr-1 pl-2.5"
      role="listitem"
    >
      <Icon
        class="size-3.5 flex-none text-muted-foreground"
        aria-hidden="true"
      />
      <span
        class="min-w-0 flex-1 truncate font-mono text-ui"
        title={source.path}>{source.label}</span
      >
      {#if source.script}<Badge variant={highlight ? "warning" : "neutral"}
          >Script</Badge
        >{/if}
      {#if onOpen}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Open ${source.label}`}
          onclick={() => onOpen(source.path)}>Open</Button
        >
      {/if}
    </div>
  {:else}
    <p class="px-2.5 py-2 text-ui text-muted-foreground">No files.</p>
  {/each}
</div>
