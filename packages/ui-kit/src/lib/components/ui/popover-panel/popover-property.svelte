<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  label,
  value,
  valueClass,
  title,
  children,
}: {
  label: string;
  value?: string;
  valueClass?: string;
  title?: string;
  /** Custom value content; wins over `value`. */
  children?: Snippet;
} = $props();
</script>

<div class="flex items-center justify-between gap-4">
  <dt class="flex-none text-muted-foreground">{label}</dt>
  <dd
    class={cn("min-w-0 truncate tabular-nums text-foreground", valueClass)}
    {title}
  >
    {#if children}{@render children()}{:else}{value ?? "—"}{/if}
  </dd>
</div>
