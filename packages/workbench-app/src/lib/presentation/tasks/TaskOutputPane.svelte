<script lang="ts">
import Terminal from "@lucide/svelte/icons/terminal";
import type { TaskLogQueryResponse, TaskRecord } from "@nervekit/contracts";
import TaskLogTerminal from "./TaskLogTerminal.svelte";
import TaskRunSwitcher from "./TaskRunSwitcher.svelte";

type Props = {
  task?: Pick<TaskRecord, "id" | "command" | "status" | "error" | "runtime">;
  taskLogs?: TaskLogQueryResponse;
  siblingRuns?: readonly TaskRecord[];
  canRestart?: boolean;
  canCancel?: boolean;
  onLoadEarlier?: () => void | Promise<void>;
  onSelectRun?: (taskId: string) => void | Promise<void>;
  onRestartRun?: (taskId: string) => void | Promise<void>;
  onCancelRun?: (taskId: string) => void | Promise<void>;
  onForceKillRun?: (taskId: string) => void | Promise<void>;
  onCleanupRuns?: (taskIds: readonly string[]) => void | Promise<void>;
};

let {
  task,
  taskLogs,
  siblingRuns = [],
  canRestart = true,
  canCancel = true,
  onLoadEarlier,
  onSelectRun,
  onRestartRun,
  onCancelRun,
  onForceKillRun,
  onCleanupRuns,
}: Props = $props();
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
  {#if task}
    {#if task.status === "recovered" || task.status === "recovery_unknown" || task.status === "orphaned"}
      <div
        class="border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
      >
        {task.status === "recovered"
          ? "Process recovered after host restart. Captured output is frozen; stop or restart to resume supervised logs."
          : (task.error ??
            "Process identity could not be verified safely. Destructive PID actions are restricted.")}
        {#if task.runtime?.childPid}<span class="ml-2 font-mono"
            >PID {task.runtime.childPid}</span
          >{/if}
      </div>
    {/if}
    <div class="relative min-h-0 flex-1">
      {#key task.id}
        <TaskLogTerminal
          taskId={task.id}
          {taskLogs}
          command={task.command}
          {onLoadEarlier}
        />
      {/key}
      <TaskRunSwitcher
        currentTaskId={task.id}
        runs={siblingRuns}
        {canRestart}
        {canCancel}
        {onSelectRun}
        {onRestartRun}
        {onCancelRun}
        {onForceKillRun}
        {onCleanupRuns}
      />
    </div>
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
