<script lang="ts">
import Terminal from "@lucide/svelte/icons/terminal";
import type { TaskLogQueryResponse, TaskRecord } from "@nervekit/contracts";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import TaskLogTerminal from "./TaskLogTerminal.svelte";

type Props = {
  task?: Pick<TaskRecord, "id" | "command" | "status" | "error" | "runtime">;
  taskLogs?: TaskLogQueryResponse;
  runs?: readonly TaskRecord[];
  onSelectRun?: (taskId: string) => void;
  onLoadEarlier?: () => void | Promise<void>;
};

let { task, taskLogs, runs = [], onSelectRun, onLoadEarlier }: Props = $props();
const runItems = $derived(
  [...runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((run) => ({
      value: run.id,
      label: `${run.status} · ${new Date(run.startedAt).toLocaleString()}`,
      detail: run.id,
    })),
);
</script>

<section class="h-full min-h-0 bg-background">
  {#if task}
    {#if runItems.length > 1}
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <span class="shrink-0 text-xs text-muted-foreground">Run history</span>
        <SelectField
          items={runItems}
          value={task.id}
          ariaLabel="Selected task run"
          triggerClass="ml-auto max-w-72"
          onValueChange={(value: string) => onSelectRun?.(value)}
        />
      </div>
    {/if}
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
