<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  title,
  count,
  trailing,
  class: className,
}: {
  title: string;
  count?: number;
  trailing?: Snippet;
  class?: string;
} = $props();
</script>

<div class={cn("flex h-7 min-w-0 shrink-0 items-center gap-1", className)}>
  <span class="truncate text-xs font-semibold text-foreground">{title}</span>
  {#if count !== undefined}
    <span class="text-xs text-muted-foreground">{count}</span>
  {/if}
  {#if trailing}
    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      {@render trailing()}
    </div>
  {/if}
</div>
