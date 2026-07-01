<script lang="ts">
  import Database from "@lucide/svelte/icons/database";
  import type { ConfluenceSpaceSummaryPayload } from "@nervekit/shared";
  import { Badge } from "$lib/components/ui/badge";
  import { confluenceStatusBadgeTone } from "$lib/features/tools/views/confluence-display";

  type Props = { space: ConfluenceSpaceSummaryPayload };
  let { space }: Props = $props();

  const hasChips = $derived(Boolean(space.status || space.type));
</script>

<div class="grid gap-1.5 rounded-sm border bg-sidebar px-2.5 py-2">
  <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
    <span class="inline-flex items-center gap-1.5">
      <Database size={13} strokeWidth={2} class="shrink-0 text-muted-foreground" />
      {#if space.key}
        <span class="font-mono text-xs font-semibold text-sidebar-foreground">{space.key}</span>
      {/if}
      <span class="font-mono text-xs text-muted-foreground">{space.id}</span>
    </span>
    {#if space.name}
      <span class="min-w-0 break-words text-xs font-medium leading-snug text-sidebar-foreground">{space.name}</span>
    {/if}
  </div>

  {#if hasChips}
    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {#if space.status}
        <Badge tone={confluenceStatusBadgeTone(space.status)} size="xs">{space.status}</Badge>
      {/if}
      {#if space.type}
        <span class="text-xs text-muted-foreground">{space.type}</span>
      {/if}
    </div>
  {/if}
</div>
