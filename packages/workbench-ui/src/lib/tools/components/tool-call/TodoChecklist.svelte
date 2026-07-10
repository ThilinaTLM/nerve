<script lang="ts">
  import Circle from "@lucide/svelte/icons/circle";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import type { TodoItem } from "@nervekit/contracts";

  type Props = { items: TodoItem[]; emptyLabel?: string };
  let { items, emptyLabel = "No todos set." }: Props = $props();
</script>

{#if items.length === 0}
  <p class="m-0 text-sm text-muted-foreground">{emptyLabel}</p>
{:else}
  <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Todo list">
    {#each items as item}
      <li class={`grid grid-cols-[auto_1fr] items-start gap-2 text-sm leading-normal ${item.done ? "text-muted-foreground" : "text-foreground"}`}>
        {#if item.done}
          <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" class="mt-0.5 text-success" />
        {:else}
          <Circle size={15} strokeWidth={2.2} aria-hidden="true" class="mt-0.5 text-muted-foreground" />
        {/if}
        <span class="min-w-0 [overflow-wrap:anywhere]" class:line-through={item.done}>{item.todo}</span>
      </li>
    {/each}
  </ul>
{/if}
