<script lang="ts">
  import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
  import type { ToolView } from "../../views/tool-result-view";
  import TaskRow from "./TaskRow.svelte";

  type Props = { toolCall: ToolCallDisplayRecord; view: Extract<ToolView, { kind: "task_action" }> };
  let { view }: Props = $props();

  const tasks = $derived(view.tasks ?? (view.task ? [view.task] : []));
</script>

{#if tasks.length > 0}
  <div class="grid gap-1">
    {#each tasks as task (task.id)}
      <TaskRow {task} />
    {/each}
  </div>
{/if}
