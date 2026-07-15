<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import TaskRow from "./TaskRow.svelte";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "task_action" }>;
};
let { toolCall, view }: Props = $props();

const completionLabel = $derived(
  view.action === "start"
    ? "Task started"
    : view.action === "restart"
      ? "Task restarted"
      : "Cancellation completed",
);

const tasks = $derived(view.tasks ?? (view.task ? [view.task] : []));
</script>

{#if tasks.length > 0}
  <div class="grid gap-1.5">
    {#if toolCall.status === "completed"}
      <p class="m-0 text-xs font-medium text-muted-foreground">
        {completionLabel}; process state is shown below.
      </p>
    {/if}
    {#each tasks as task (task.id)}
      <TaskRow {task} />
    {/each}
    {#if view.action === "restart" && view.task?.restartedFromTaskId}
      <p class="m-0 text-xs text-muted-foreground">
        Replacement <span class="font-mono">{view.task.id}</span> restarted
        <span class="font-mono">{view.task.restartedFromTaskId}</span>.
      </p>
    {/if}
  </div>
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No task record returned.</p>
{/if}

{#if view.liveLog}
  <section class="grid gap-1" aria-label="Task startup output">
    <ToolOutputBlock
      text={view.liveLog}
      direction="tail"
      collapsedLines={10}
      terminal
    />
  </section>
{/if}
