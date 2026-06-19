<script lang="ts">
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import TaskRow from "./TaskRow.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "task_list" }> };
  let { view }: Props = $props();
</script>

{#if view.tasks.length === 0}
  <p class="m-0 text-xs text-muted-foreground">No tasks.</p>
{:else}
  <div class="grid gap-1">
    {#each view.tasks as task (task.id)}
      <TaskRow {task} dense />
    {/each}
  </div>
{/if}
