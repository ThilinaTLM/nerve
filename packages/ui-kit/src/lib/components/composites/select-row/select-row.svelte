<script lang="ts" module>
import type { VariantProps } from "tailwind-variants";
import { tv } from "@nervekit/ui-kit/utils";

/**
 * State recipe of every selectable row: hover, selection (tint, foreground
 * label, brand marker on the leading icon), keyboard highlight, and disabled. Layout
 * stays with each row, so rows with their own structure (listbox options,
 * tree rows) reuse the same states. The marker sits on the icon wrapper, so
 * glyphs with their own colour (status, file type, provider) keep it.
 */
export const selectRowVariants = tv({
  slots: {
    base: "rounded-md text-ui transition-colors hover:bg-hover focus-visible:ring-3 focus-visible:ring-focus focus-visible:outline-none",
    icon: "text-muted-foreground",
    label: "",
  },
  variants: {
    selected: {
      true: {
        base: "bg-selected hover:bg-selected",
        icon: "text-primary",
        label: "text-foreground",
      },
    },
    highlighted: {
      true: { base: "outline outline-1 -outline-offset-1 outline-focus" },
    },
    disabled: {
      true: { base: "pointer-events-none opacity-50" },
    },
  },
});

export type SelectRowVariants = VariantProps<typeof selectRowVariants>;
</script>

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
  highlighted = false,
  current,
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
  /** The current value. Reads as a tint, medium label and brand icon. */
  selected?: boolean;
  /** Keyboard highlight in a navigable list. Distinct from `selected`. */
  highlighted?: boolean;
  /**
   * Navigation rows: the current location (`aria-current`). Pass `"page"` for
   * page navigation. Any defined value (even `false`) drops `aria-pressed`.
   */
  current?: boolean | "page";
  disabled?: boolean;
  /** Native tooltip (e.g. the raw model id shown on hover). */
  title?: string;
  icon?: Snippet;
  /** Rendered after the label (e.g. a shortcut hint). */
  trailing?: Snippet;
  class?: string;
  onclick?: () => void;
} = $props();

const styles = $derived(selectRowVariants({ selected, highlighted, disabled }));
const ariaCurrent = $derived(
  current === "page" ? "page" : current ? "true" : undefined,
);
const ariaPressed = $derived(
  role === undefined && current === undefined ? selected : undefined,
);
</script>

<button
  type="button"
  {id}
  {role}
  {tabindex}
  aria-selected={ariaSelected}
  aria-current={ariaCurrent}
  aria-pressed={ariaPressed}
  {disabled}
  {title}
  class={styles.base({
    class: cn(
      "grid min-h-control w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-1.5 py-1 text-left",
      className,
    ),
  })}
  {onclick}
>
  {#if icon}<span
      class={styles.icon({ class: "col-start-1 flex items-center" })}
      >{@render icon()}</span
    >{/if}
  {#if typeof label === "string"}
    <span
      class={styles.label({
        class: cn(
          "block min-w-0 truncate text-foreground",
          icon ? "col-start-2" : "col-span-2 col-start-1",
        ),
      })}
    >
      {label}
    </span>
  {:else}
    <span
      class={styles.label({
        class: cn("min-w-0", icon ? "col-start-2" : "col-span-2 col-start-1"),
      })}
    >
      {@render label()}
    </span>
  {/if}
  {#if trailing}<span class="col-start-3 flex items-center"
      >{@render trailing()}</span
    >{/if}
  {#if typeof detail === "string"}
    <span class="col-span-3 line-clamp-2 text-muted-foreground">{detail}</span>
  {:else if detail}
    <span class="col-span-3 min-w-0">{@render detail()}</span>
  {/if}
</button>
