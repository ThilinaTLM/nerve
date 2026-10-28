<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  id,
  role,
  tabindex,
  "aria-selected": ariaSelected,
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
  id?: string;
  role?: "option";
  tabindex?: number;
  "aria-selected"?: boolean;
  label: string | Snippet;
  /** Secondary line: plain text, or a snippet for richer markup (e.g. mono ids). */
  detail?: string | Snippet;
  /** The current value. Reads as a tint. */
  selected?: boolean;
  /** Keyboard highlight in a navigable list. Distinct from `selected`. */
  active?: boolean;
  disabled?: boolean;
  /** Native tooltip (e.g. the raw model id shown on hover). */
  title?: string;
  icon?: Snippet;
  /** Rendered after the label (e.g. a shortcut hint). */
  trailing?: Snippet;
  class?: string;
  onclick?: () => void;
} = $props();
</script>

<button
  type="button"
  {id}
  {role}
  {tabindex}
  aria-selected={ariaSelected}
  {disabled}
  {title}
  aria-pressed={role === "option" ? undefined : selected}
  class={cn(
    "grid min-h-7 w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent",
    selected && "bg-selected hover:bg-selected",
    active && "outline outline-1 -outline-offset-1 outline-ring/55",
    disabled && "pointer-events-none opacity-55",
    className,
  )}
  {onclick}
>
  {#if icon}<span class="col-start-1 flex items-center">{@render icon()}</span
    >{/if}
  <span class={cn("min-w-0", icon ? "col-start-2" : "col-span-2 col-start-1")}>
    {#if typeof label === "string"}
      <span
        class={cn("block truncate text-foreground", selected && "font-medium")}
      >
        {label}
      </span>
    {:else}
      {@render label()}
    {/if}
  </span>
  {#if trailing}<span class="col-start-3 flex items-center"
      >{@render trailing()}</span
    >{/if}
  {#if typeof detail === "string"}
    <span class="col-span-3 line-clamp-2 text-muted-foreground">{detail}</span>
  {:else if detail}
    <span class="col-span-3 min-w-0">{@render detail()}</span>
  {/if}
</button>
