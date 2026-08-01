<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  label,
  detail,
  selected = false,
  disabled = false,
  title,
  icon,
  trailing,
  class: className,
  onclick,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  icon?: Snippet;
  /** Rendered between the text and the selected check (e.g. a shortcut hint). */
  trailing?: Snippet;
  class?: string;
  onclick?: () => void;
} = $props();
</script>

<button
  type="button"
  {disabled}
  {title}
  aria-pressed={selected}
  class={cn(
    "flex w-full items-center gap-2.5 rounded-md border border-border bg-transparent px-2 py-2 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-55",
    selected && "bg-accent",
    className,
  )}
  {onclick}
>
  {@render icon?.()}
  <span class="grid min-w-0 flex-1 gap-0.5">
    <span class="truncate text-xs font-medium text-foreground">{label}</span>
    {#if detail}
      <span class="text-xs text-muted-foreground">{detail}</span>
    {/if}
  </span>
  {@render trailing?.()}
  {#if selected}
    <Check class="size-3.5 flex-none text-primary" aria-hidden="true" />
  {/if}
</button>
