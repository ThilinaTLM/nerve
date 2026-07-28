<script lang="ts">
import Tag from "@lucide/svelte/icons/tag";
import type { JiraFieldSummaryPayload } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";

type Props = { field: JiraFieldSummaryPayload };
let { field }: Props = $props();

const allowed = $derived(field.allowedValues ?? []);
</script>

<div class="grid gap-1 rounded-sm border bg-sidebar px-2.5 py-2">
  <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
    {#if field.name}
      <span
        class="min-w-0 break-words text-xs font-medium text-sidebar-foreground"
        >{field.name}</span
      >
    {/if}
    <span class="font-mono text-xs text-muted-foreground">{field.id}</span>
  </div>
  {#if field.type || field.required || field.custom || allowed.length > 0}
    <div class="flex flex-wrap items-center gap-1.5">
      {#if field.type}
        <Badge tone="neutral" size="xs">{field.type}</Badge>
      {/if}
      {#if field.required}
        <Badge tone="warn" size="xs">required</Badge>
      {/if}
      {#if field.custom}
        <Badge tone="accent" size="xs">custom</Badge>
      {/if}
      {#if allowed.length > 0}
        <span
          class="inline-flex items-center gap-1 text-xs text-muted-foreground"
          title={allowed.join(", ")}
        >
          <Tag size={11} strokeWidth={2} />
          {allowed.length} allowed
        </span>
      {/if}
    </div>
  {/if}
</div>
