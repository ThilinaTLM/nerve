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
  label: string | Snippet;
  /** Secondary line: plain text, or a snippet for richer markup (e.g. mono ids). */
  detail?: string | Snippet;
  selected?: boolean;
  disabled?: boolean;
  /** Native tooltip (e.g. the raw model id shown on hover). */
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
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md border bg-accent/90 px-2 py-2 text-left transition-colors hover:bg-accent/95 dark:bg-accent/60 dark:hover:bg-accent/70",
    selected ? "border-primary" : "border-transparent",
    disabled && "pointer-events-none opacity-55",
    className,
  )}
  {onclick}
>
  {@render icon?.()}
  <span class="grid min-w-0 flex-1 gap-0.5">
    {#if typeof label === "string"}
      <span class="truncate text-xs font-medium text-foreground">{label}</span>
    {:else}
      {@render label()}
    {/if}
    {#if typeof detail === "string"}
      <span class="truncate text-xs text-muted-foreground">{detail}</span>
    {:else if detail}
      {@render detail()}
    {/if}
  </span>
  {@render trailing?.()}
  {#if selected}
    <Check class="size-3.5 flex-none text-primary" aria-hidden="true" />
  {/if}
</button>
