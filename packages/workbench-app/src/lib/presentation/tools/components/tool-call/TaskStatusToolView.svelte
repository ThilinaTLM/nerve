<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import TaskRow from "./TaskRow.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "task_status" }>;
};
let { toolCall, view }: Props = $props();
</script>

{#if view.tasks.length === 0 && toolCall.status === "completed"}
  <p
    class="m-0 text-xs"
    class:text-warning={view.previewUnavailable}
    class:text-muted-foreground={!view.previewUnavailable}
  >
    {view.previewUnavailable
      ? "Task status preview unavailable. Open Details to inspect the full result."
      : "No matching tasks."}
  </p>
{:else if view.tasks.length > 0}
  <div class="grid gap-1">
    {#each view.tasks as task (task.id)}
      <TaskRow {task} dense />
    {/each}
  </div>
{/if}
