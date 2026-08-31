<script lang="ts">
import Circle from "@lucide/svelte/icons/circle";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import type { TodoItem } from "@nervekit/contracts/tools";

type Props = {
  items: TodoItem[];
  emptyLabel?: string;
  /** Renders at the popover type scale instead of the transcript's. */
  dense?: boolean;
};
let { items, emptyLabel = "No todos set.", dense = false }: Props = $props();

const textClass = $derived(dense ? "text-xs" : "text-sm");
const iconSize = $derived(dense ? 13 : 15);
</script>

{#if items.length === 0}
  <p class={`m-0 text-muted-foreground ${textClass}`}>{emptyLabel}</p>
{:else}
  <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Todo list">
    {#each items as item, index (`${item.todo}:${item.done}:${index}`)}
      <li
        class={`grid grid-cols-[auto_1fr] items-start gap-2 leading-normal ${textClass} ${item.done ? "text-muted-foreground" : "text-foreground"}`}
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
          class:line-through={item.done}>{item.todo}</span
        >
      </li>
    {/each}
  </ul>
{/if}
