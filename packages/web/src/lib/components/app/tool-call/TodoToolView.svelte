<script lang="ts">
  import Circle from "@lucide/svelte/icons/circle";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  type Props = {
    toolCall: ToolCallRecord;
    view: Extract<ToolView, { kind: "todos" }>;
  };
  let { view }: Props = $props();
</script>

{#if view.items.length === 0}
  <p class="empty">No todos set.</p>
{:else}
  <ul class="todo-list" aria-label="Todo list">
    {#each view.items as item}
      <li class:done={item.done}>
        {#if item.done}
          <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" />
        {:else}
          <Circle size={15} strokeWidth={2.2} aria-hidden="true" />
        {/if}
        <span>{item.todo}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 0.8125rem;
  }

  .todo-list {
    display: grid;
    gap: 0.38rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: 0.45rem;
    color: var(--foreground);
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  li :global(svg) {
    margin-top: 0.12rem;
    color: var(--muted-foreground);
  }

  li.done {
    color: var(--muted-foreground);
  }

  li.done span {
    text-decoration: line-through;
  }

  li.done :global(svg) {
    color: var(--success, var(--primary));
  }
</style>
