<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  label,
  detail,
  selected = false,
  active = false,
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
  /** The current value. Reads as a tint plus a trailing check. */
  selected?: boolean;
  /** Keyboard highlight in a navigable list. Distinct from `selected`. */
  active?: boolean;
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
    "flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent",
    selected && "bg-selected hover:bg-selected",
    active && "outline outline-1 -outline-offset-1 outline-ring/55",
    disabled && "pointer-events-none opacity-55",
    className,
  )}
  {onclick}
>
  {@render icon?.()}
  <span class="grid min-w-0 flex-1 gap-0.5">
    {#if typeof label === "string"}
      <span class={cn("truncate text-foreground", selected && "font-medium")}>
        {label}
      </span>
    {:else}
      {@render label()}
    {/if}
    {#if typeof detail === "string"}
      <span class="line-clamp-2 text-muted-foreground">{detail}</span>
    {:else if detail}
      {@render detail()}
    {/if}
  </span>
  {@render trailing?.()}
  {#if selected}
    <CircleCheck
      class="size-3.5 flex-none text-foreground"
      aria-hidden="true"
    />
  {/if}
</button>
