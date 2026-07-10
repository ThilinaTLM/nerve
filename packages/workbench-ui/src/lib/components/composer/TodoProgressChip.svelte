<script lang="ts">
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import type { TodoItem } from "@nervekit/contracts";
  import Popover from "@nervekit/workbench-ui/components/ui/popover-panel";
  import TodoChecklist from "../../tools/components/tool-call/TodoChecklist.svelte";

  type Props = { todos: TodoItem[] };
  let { todos }: Props = $props();

  let open = $state(false);

  const total = $derived(todos.length);
  const completed = $derived(todos.filter((item) => item.done).length);
  const percent = $derived(total > 0 ? (completed / total) * 100 : 0);
  const allDone = $derived(total > 0 && completed === total);
  const title = $derived(`Todos: ${completed} of ${total} complete`);
</script>

{#if total > 0}
  <Popover
    bind:open
    class="todo-progress-content"
    triggerClass="composer-tab todo-progress-tab"
    ariaLabel="Todo progress"
    triggerTitle={title}
    side="top"
    align="end"
    sideOffset={9}
  >
    {#snippet trigger()}
      <span class="todo-tab-inner" class:complete={allDone} style={`--todo-fill: ${percent}%;`}>
        <span class="todo-ring" aria-hidden="true"><span class="todo-ring-core"></span></span>
        <ListChecks size={13} strokeWidth={2.2} aria-hidden="true" />
        <span class="todo-count">{completed}/{total}</span>
      </span>
    {/snippet}

    <div class="todo-popover">
      <div class="todo-popover-head">
        <p class="todo-popover-heading">Todo list</p>
        <span class="todo-popover-count">{completed}/{total}</span>
      </div>
      <TodoChecklist items={todos} />
    </div>
  </Popover>
{/if}

<style>
  .todo-tab-inner {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: inherit;
  }

  .todo-ring {
    --todo-color: var(--primary);
    display: inline-grid;
    width: 0.8rem;
    height: 0.8rem;
    place-items: center;
    border-radius: 999px;
    background: conic-gradient(
      var(--todo-color) var(--todo-fill),
      color-mix(in oklab, var(--border) 82%, transparent) 0
    );
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 7%, transparent) inset;
  }

  .todo-tab-inner.complete .todo-ring {
    --todo-color: var(--success);
  }

  .todo-ring-core {
    width: 0.48rem;
    height: 0.48rem;
    border-radius: inherit;
    background: var(--card);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 4%, transparent);
  }

  .todo-count {
    color: var(--foreground);
  }

  .todo-popover {
    display: grid;
    gap: 0.55rem;
    padding: 0.7rem;
    max-height: min(48vh, 20rem);
    overflow-y: auto;
  }

  .todo-popover-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .todo-popover-heading {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .todo-popover-count {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 600;
  }
</style>
