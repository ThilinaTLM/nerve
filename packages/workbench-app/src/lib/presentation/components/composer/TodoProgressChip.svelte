<script lang="ts">
import ListChecks from "@lucide/svelte/icons/list-checks";
import type { TodoItem } from "@nervekit/contracts";
import Popover, {
  PopoverBody,
  PopoverHeader,
} from "@nervekit/ui-kit/components/ui/popover-panel";
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
    class="popover-xl"
    triggerClass="composer-tab todo-progress-tab"
    ariaLabel="Todo progress"
    triggerTitle={title}
    side="top"
    align="end"
    sideOffset={9}
  >
    {#snippet trigger()}
      <span
        class="todo-tab-inner"
        class:complete={allDone}
        style={`--todo-fill: ${percent}%;`}
      >
        <span class="todo-ring rounded-full" aria-hidden="true"
          ><span class="todo-ring-core"></span></span
        >
        <ListChecks size={13} strokeWidth={2.2} aria-hidden="true" />
        <span class="todo-count">{completed}/{total}</span>
      </span>
    {/snippet}

    <PopoverBody class="max-h-[min(48vh,20rem)] overflow-y-auto">
      <PopoverHeader title="Todo list" meta={`${completed}/${total}`} />
      <TodoChecklist items={todos} dense />
    </PopoverBody>
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
  background: conic-gradient(
    var(--todo-color) var(--todo-fill),
    color-mix(in oklab, var(--border) 82%, transparent) 0
  );
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--foreground) 7%, transparent)
    inset;
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
</style>
