<script lang="ts">
  import Circle from "@lucide/svelte/icons/circle";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import type { ToolCallDisplayRecord } from "$lib/features/tools/views/tool-result-view";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "todos" }>;
  };
  let { view }: Props = $props();
</script>

{#if view.items.length === 0}
  <p class="m-0 text-sm text-muted-foreground">No todos set.</p>
{:else}
  <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Todo list">
    {#each view.items as item}
      <li class={`grid grid-cols-[auto_1fr] items-start gap-2 text-sm leading-normal ${item.done ? "text-muted-foreground" : "text-foreground"}`}>
        {#if item.done}
          <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" class="mt-0.5 text-success" />
        {:else}
          <Circle size={15} strokeWidth={2.2} aria-hidden="true" class="mt-0.5 text-muted-foreground" />
        {/if}
        <span class:line-through={item.done}>{item.todo}</span>
      </li>
    {/each}
  </ul>
{/if}
