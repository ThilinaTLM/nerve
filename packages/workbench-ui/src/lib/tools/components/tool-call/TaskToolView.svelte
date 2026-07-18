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

const completionMessage = $derived(
  view.action === "start"
    ? "Task started; process state is shown below."
    : view.action === "restart"
      ? "Task restarted; process state is shown below."
      : "Cancellation completed.",
);

const tasks = $derived(view.tasks ?? (view.task ? [view.task] : []));
const outcomes = $derived(view.outcomes ?? []);
const hasResult = $derived(tasks.length > 0 || outcomes.length > 0);
</script>

{#if hasResult}
  <div class="grid gap-1.5">
    {#if toolCall.status === "completed"}
      <p class="m-0 text-xs font-medium text-muted-foreground">
        {completionMessage}
      </p>
    {/if}
    {#if view.action === "cancel"}
      {#each outcomes as outcome, index (`${outcome.task?.id ?? "none"}-${index}`)}
        <div class="grid gap-1">
          {#if outcome.task}<TaskRow task={outcome.task} />{/if}
          <p
            class="m-0 break-words text-xs"
            class:text-warning={outcome.outcome === "already_terminal" ||
              outcome.outcome === "became_terminal_before_cancel"}
            class:text-muted-foreground={outcome.outcome !==
              "already_terminal" &&
              outcome.outcome !== "became_terminal_before_cancel"}
          >
            {outcome.message}
          </p>
        </div>
      {/each}
    {:else}
      {#each tasks as task (task.id)}
        <TaskRow {task} />
      {/each}
    {/if}
    {#if view.action === "restart" && view.task && view.restartedFromTaskId}
      <p class="m-0 text-xs text-muted-foreground">
        Replacement <span class="font-mono">{view.task.id}</span> restarted
        <span class="font-mono">{view.restartedFromTaskId}</span>.
      </p>
    {/if}
  </div>
{:else if toolCall.status === "completed" && view.previewUnavailable}
  <p class="m-0 text-xs text-warning">
    Task result preview unavailable. Open Details to inspect the full result.
  </p>
{/if}

{#if view.liveLog}
  <section class="grid gap-1" aria-label="Task startup output">
    <ToolOutputBlock text={view.liveLog} direction="tail" terminal />
  </section>
{/if}
