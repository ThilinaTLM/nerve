<script lang="ts">
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import TaskRow from "./TaskRow.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "task_action" }> };
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
