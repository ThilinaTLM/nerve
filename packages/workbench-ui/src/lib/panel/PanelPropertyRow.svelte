<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  label,
  value,
  mono = false,
  title,
  actions,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  title?: string;
  actions?: Snippet;
  /** Custom value rendering; replaces `value`. */
  children?: Snippet;
} = $props();
</script>

<div
  class="panel-row group/panel-row flex min-h-7 min-w-0 items-center gap-2 pr-1.5 text-xs"
>
  <span class="w-24 shrink-0 truncate text-muted-foreground">{label}</span>
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
