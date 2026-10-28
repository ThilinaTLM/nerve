<script lang="ts" generics="Item extends CommandItem">
import { onMount, type Snippet } from "svelte";
import {
  filterCommandItems,
  type CommandItem,
} from "../../../collections/command-filter.js";
import SearchInput from "../search-input/search-input.svelte";
import PopoverSearch from "./popover-search.svelte";
import PopoverBody from "./popover-body.svelte";
import PopoverSection from "./popover-section.svelte";
import PopoverRow from "../select-row/select-row.svelte";
import { createListNavigation } from "./list-navigation.svelte.js";

let {
  items,
  query = $bindable(""),
  placeholder = "Search",
  ariaLabel,
  isSelected = () => false,
  isDisabled = () => false,
  onChoose,
  row,
  rowMode = "button",
  empty = "No matching choices.",
  stableHeight,
  autofocus = true,
}: {
  items: Item[];
  query?: string;
  placeholder?: string;
  ariaLabel: string;
  isSelected?: (item: Item) => boolean;
  isDisabled?: (item: Item) => boolean;
  onChoose: (item: Item) => void;
  row?: Snippet<[Item, { active: boolean; selected: boolean }]>;
  /** Container rows render custom content directly and allow embedded controls.
   * Their controls never choose the row; disabled rows keep those controls usable. */
  rowMode?: "button" | "container";
  empty?: string | Snippet;
  stableHeight?: string;
  autofocus?: boolean;
} = $props();
const id = $props.id();
let input = $state<HTMLInputElement | null>(null);
let viewport = $state<HTMLDivElement>();
const groups = $derived(filterCommandItems(items, query));
const enabled = $derived(
  groups.flatMap((group) => group.items).filter((item) => !isDisabled(item)),
);
const rowId = (item: Item) => `${id}-${encodeURIComponent(item.key)}`;
const navigation = createListNavigation({
  items: () => enabled,
  getId: rowId,
  viewport: () => viewport,
  onChoose: (item) => onChoose(item),
});
$effect(() => {
  void query;
  navigation.reset();
});
onMount(() => {
  // Let the primitive capture the trigger as its restore target first.
  if (!autofocus) return;
  const frame = requestAnimationFrame(() => input?.focus());
  return () => cancelAnimationFrame(frame);
});
function chooseContainer(event: MouseEvent | KeyboardEvent, item: Item) {
  if (isDisabled(item) || event.defaultPrevented) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'button, input, select, textarea, a, label, [role="button"], [role="switch"], [role="checkbox"]',
    )
  )
    return;
  onChoose(item);
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    navigation.chooseActive();
  } else navigation.handleKeydown(event);
}
</script>

<PopoverSearch class="pt-2">
  <SearchInput
    bind:value={query}
    bind:ref={input}
    {placeholder}
    {ariaLabel}
    controls={id}
    activeDescendant={navigation.activeDescendant}
    onkeydown={keydown}
  />
</PopoverSearch>
<PopoverBody bind:ref={viewport} {id} role="listbox" {ariaLabel} {stableHeight}>
  {#each groups as group (group.group)}
    <PopoverSection label={group.group}>
      {#each group.items as item (item.key)}
        {#snippet customLabel()}{@render row?.(item, {
            active: navigation.activeDescendant === rowId(item),
            selected: isSelected(item),
          })}{/snippet}
        {#if rowMode === "container"}
          <div
            id={rowId(item)}
            role="option"
            tabindex={-1}
            aria-selected={isSelected(item)}
            data-disabled={isDisabled(item) || undefined}
            class={[
              "min-h-7 rounded-md text-xs",
              isSelected(item) && "bg-selected",
              navigation.activeDescendant === rowId(item) &&
                "outline outline-1 -outline-offset-1 outline-ring/55",
            ]}
            onclick={(event) => chooseContainer(event, item)}
            onkeydown={(event) => {
              if (
                event.key === "Enter" &&
                event.target === event.currentTarget
              ) {
                chooseContainer(event, item);
                event.preventDefault();
              }
            }}
          >
            {#if row}{@render row(item, {
                active: navigation.activeDescendant === rowId(item),
                selected: isSelected(item),
              })}{:else}{item.label}{/if}
          </div>
        {:else}
          <PopoverRow
            id={rowId(item)}
            role="option"
            tabindex={-1}
            aria-selected={isSelected(item)}
            label={row ? customLabel : item.label}
            detail={row
              ? undefined
              : "detail" in item && typeof item.detail === "string"
                ? item.detail
                : undefined}
            active={navigation.activeDescendant === rowId(item)}
            selected={isSelected(item)}
            disabled={isDisabled(item)}
            onclick={() => onChoose(item)}
          />
        {/if}
      {/each}
    </PopoverSection>
  {:else}
    <div class="px-3 py-6 text-center text-xs text-muted-foreground">
      {#if typeof empty === "string"}{empty}{:else}{@render empty()}{/if}
    </div>
  {/each}
</PopoverBody>
