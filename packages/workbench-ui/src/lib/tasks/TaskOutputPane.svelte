<script lang="ts">
import Terminal from "@lucide/svelte/icons/terminal";
import type { TaskLogQueryResponse, TaskRecord } from "@nervekit/contracts";
import TaskLogTerminal from "./TaskLogTerminal.svelte";

type Props = {
  task?: Pick<TaskRecord, "id" | "command">;
  taskLogs?: TaskLogQueryResponse;
  onLoadEarlier?: () => void | Promise<void>;
};

let { task, taskLogs, onLoadEarlier }: Props = $props();
</script>

<section class="h-full min-h-0 bg-background">
  {#if task}
    {#key task.id}
      <TaskLogTerminal
        taskId={task.id}
        {taskLogs}
        command={task.command}
        {onLoadEarlier}
      />
    {/key}
  {:else}
    <div
      class="grid min-h-full place-content-center gap-1 text-center text-muted-foreground"
    >
      <Terminal class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="mt-1 text-foreground">Task not found.</p>
      <span class="text-xs">
        The task may have been removed or is no longer available.
      </span>
    </div>
  {/if}
</section>
