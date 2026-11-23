<!--
@component
Labelled select (the field to put in a `FieldRow` control); the same props as the UI kit's. In a frame the list is the host's picker (`host.ui.pick`), drawn outside the frame with a search field above 8 items, so values are at most 128 characters and there are at most 2,000 items.
-->

<script lang="ts">
/* global console, MouseEvent, HTMLElement -- a frame component runs in the browser */
// `SelectField` of frames. Same props as the UI kit's: that one opens a list inside the frame,
// where the frame's rectangle clips it. This one opens the host's picker (`host.ui.pick`).
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import { cn } from "@nervekit/ui-kit";
import type { SelectItem } from "@nervekit/ui-kit/components/composites/select-field";
import { host } from "@nervekit/extension-sdk/ui";

let {
  id,
  items = [],
  value = $bindable(""),
  placeholder = "Select",
  disabled = false,
  ariaLabel,
  class: className,
  triggerClass,
  onValueChange,
}: {
  /** Id of the button, for `FieldRow htmlFor`. */
  id?: string;
  /** The choices. */
  items?: SelectItem[];
  /** `value` of the chosen item; `bind:value`. */
  value?: string;
  /** Shown while nothing is chosen (default "Select"). */
  placeholder?: string;
  /** Not openable. */
  disabled?: boolean;
  /** Accessible name; also the title of the host's list. */
  ariaLabel?: string;
  class?: string;
  /** Classes of the button; `class` styles its wrapper. */
  triggerClass?: string;
  /** Accepted for compatibility with the UI kit's field; the host draws the list. */
  contentClass?: string;
  /** Called with the chosen `value`. */
  onValueChange?: (value: string) => void;
} = $props();

const selectedLabel = $derived(
  items.find((item) => item.value === value)?.label,
);

async function open(event: MouseEvent) {
  const anchor = event.currentTarget as HTMLElement;
  try {
    const chosen = await host.ui.pick({
      mode: "single",
      ariaLabel: ariaLabel ?? placeholder,
      placeholder: "Search",
      anchor,
      selected: value ? [value] : [],
      items: items.map((item) => ({
        id: item.value,
        label: item.label,
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.disabled ? { disabled: true } : {}),
      })),
    });
    if (chosen === null || chosen === value) return;
    value = chosen;
    onValueChange?.(chosen);
  } catch (error) {
    console.error("Could not open the list", error);
  }
}
</script>

<button
  {id}
  type="button"
  {disabled}
  aria-label={ariaLabel}
  aria-haspopup="listbox"
  data-placeholder={selectedLabel === undefined ? "" : undefined}
  class={cn(
    "border-input data-placeholder:text-muted-foreground hover:bg-hover focus-visible:border-ring focus-visible:ring-focus gap-1.5 rounded-md border bg-input-background py-1 pr-2 pl-2 text-ui transition-[color,box-shadow] focus-visible:ring-3 h-control flex w-full min-w-0 items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    triggerClass,
    className,
  )}
  onclick={open}
>
  <span class="truncate">{selectedLabel ?? placeholder}</span>
  <ChevronDown class="text-muted-foreground size-4" aria-hidden="true" />
</button>
