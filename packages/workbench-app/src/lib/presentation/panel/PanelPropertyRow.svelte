<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  label,
  value,
  mono = false,
  dense = false,
  labelClass,
  title,
  actions,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  /** Tightens the row rhythm for dense property lists. */
  dense?: boolean;
  labelClass?: string;
  title?: string;
  actions?: Snippet;
  /** Custom value rendering; replaces `value`. */
  children?: Snippet;
} = $props();
</script>

<div
  class={cn(
    "panel-row group/panel-row flex min-w-0 items-center pr-1.5 text-xs",
    dense ? "min-h-5 gap-1.5" : "min-h-7 gap-2",
  )}
>
  <span
    class={cn(
      "shrink-0 truncate text-muted-foreground",
      dense ? "w-20" : "w-24",
      labelClass,
    )}>{label}</span
  >
  <div class={cn("min-w-0 flex-1 truncate", mono && "font-mono")} {title}>
    {#if children}
      {@render children()}
    {:else}
      {value ?? "—"}
    {/if}
  </div>
  {#if actions}
    <div
      class="panel-hover-actions flex shrink-0 items-center gap-0.5 group-focus-within/panel-row:opacity-100 group-hover/panel-row:opacity-100"
    >
      {@render actions()}
    </div>
  {/if}
</div>
