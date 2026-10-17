<script lang="ts">
import Circle from "@lucide/svelte/icons/circle";
import CircleCheck from "@lucide/svelte/icons/circle-check";

import type { TodoItem } from "@nervekit/contracts/tools";
import { untrack } from "svelte";
import { StreamingText } from "@nervekit/ui-kit/components/composites/streaming-text";
import { getToolMotion } from "./tool-motion-context";
import { inCardSheet } from "../../cards/sheet-context";

type Props = {
  items: TodoItem[];
  emptyLabel?: string;
  /** Renders at the popover type scale instead of the transcript's. */
  dense?: boolean;
  /** Items are still streaming: new items enter and their text fades in. */
  streaming?: boolean;
};
let {
  items,
  emptyLabel = "No todos set.",
  dense = false,
  streaming = false,
}: Props = $props();

const toolMotion = getToolMotion();
const streamMotion = $derived(streaming && toolMotion.streamMotion);
// Items present at mount never enter, so remounts do not replay.
const initialCount = untrack(() => items.length);

// Inside a card sheet every item is its own hairline-divided section; the
// dense popover list and standalone use keep the compact list.
const cardSheet = inCardSheet();
const sectioned = $derived(!dense && cardSheet);

const textClass = $derived(dense ? "text-xs" : "text-sm");
const iconSize = $derived(dense ? 13 : 15);
</script>

{#if items.length === 0}
  <p
    class={`m-0 text-muted-foreground ${textClass} ${sectioned ? "px-3 py-2" : ""}`}
  >
    {emptyLabel}
  </p>
{:else if sectioned}
  <!-- Keyed by position: a streaming item's text grows in place. -->
  {#each items as item, index (index)}
    <div
      class={`flex min-w-0 items-start gap-2 px-3 py-1.5 text-sm transition-colors duration-300 ${item.done ? "text-muted-foreground" : "text-foreground"}`}
      class:stream-item-enter={streamMotion && index >= initialCount}
    >
      <span class="mt-0.5 inline-flex flex-none">
        {#if item.done}
          <CircleCheck class="size-3.5 text-success" aria-hidden="true" />
        {:else}
          <Circle class="size-3.5 text-muted-foreground" aria-hidden="true" />
        {/if}
      </span>
      <span
        class="min-w-0 [overflow-wrap:anywhere]"
        class:line-through={item.done}
        ><StreamingText text={item.todo} fade={streamMotion} /></span
      >
    </div>
  {/each}
{:else}
  <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Todo list">
    <!-- Keyed by position: a streaming item's text grows in place. -->
    {#each items as item, index (index)}
      <li
        class={`grid grid-cols-[auto_1fr] items-start gap-2 leading-normal ${textClass} ${item.done ? "text-muted-foreground" : "text-foreground"}`}
        class:stream-item-enter={streamMotion && index >= initialCount}
      >
        {#if item.done}
          <CircleCheck
            size={iconSize}
            strokeWidth={2.2}
            aria-hidden="true"
            class="mt-0.5 text-success"
          />
        {:else}
          <Circle
            size={iconSize}
            strokeWidth={2.2}
            aria-hidden="true"
            class="mt-0.5 text-muted-foreground"
          />
        {/if}
        <span
          class="min-w-0 [overflow-wrap:anywhere]"
          class:line-through={item.done}
          ><StreamingText text={item.todo} fade={streamMotion} /></span
        >
      </li>
    {/each}
  </ul>
{/if}
