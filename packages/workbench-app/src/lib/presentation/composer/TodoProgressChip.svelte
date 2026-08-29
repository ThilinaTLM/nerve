<script lang="ts">
import type { TodoItem } from "@nervekit/contracts";
import Popover, {
  PopoverBody,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { ProgressRing } from "@nervekit/ui-kit/components/composites/progress-ring";
import TodoChecklist from "../tools/tool-call/TodoChecklist.svelte";

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
    size="xl"
    triggerClass="composer-tab todo-progress-tab"
    ariaLabel="Todo progress"
    triggerTitle={title}
    side="top"
    align="end"
    sideOffset={9}
  >
    {#snippet trigger()}
      <span class="todo-tab-inner">
        <ProgressRing {percent} tone={allDone ? "good" : "primary"} />
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

.todo-count {
  color: var(--foreground);
}
</style>
