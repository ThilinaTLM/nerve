<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type { TaskLogQueryResponse, TaskRecord } from "$lib/api";
  import { shortenPath } from "$lib/core/utils/path";
  import { taskPulse, taskTone } from "$lib/core/utils/status";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import TaskLogTerminal from "./TaskLogTerminal.svelte";

  type Props = {
    task?: TaskRecord;
    taskLogs?: TaskLogQueryResponse;
    homeDir?: string;
    onRefresh?: () => void;
    onRestart?: (id: string) => void;
    onCancel?: (id: string) => void;
  };

  let {
    task,
    taskLogs,
    homeDir,
    onRefresh,
    onRestart,
    onCancel,
  }: Props = $props();

  const title = $derived(task?.name ?? task?.command ?? "Task output");
  const readiness = $derived(task?.readiness.matched ?? task?.readiness.outcome);
  const tone = $derived(taskTone(task?.status));
  const runtimeMeta = $derived(taskRuntimeLabel(task));
  const envMeta = $derived(taskEnvLabel(task));
  const cancellable = $derived(
    task ? ["starting", "running", "ready", "stopping", "orphaned"].includes(task.status) : false,
  );

  function taskRuntimeLabel(record: TaskRecord | undefined): string | undefined {
    const parts: string[] = [];
    if (record?.runtime?.childPid) parts.push(`pid ${record.runtime.childPid}`);
    if (record?.runtime?.platform) parts.push(record.runtime.platform);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }

  function taskEnvLabel(record: TaskRecord | undefined): string | undefined {
    const count = record?.envInfo?.keys.length ?? 0;
    return count > 0 ? `env ${count} redacted` : undefined;
  }
</script>

<section class="task-output-pane">
  {#if task}
    <TaskLogTerminal {taskLogs} />

    <footer class="flex items-center gap-2 border-t bg-card px-3 py-1.5">
      <StatusDot {tone} pulse={taskPulse(task.status)} />
      <Terminal class="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.2} />
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <strong class="truncate text-sm font-semibold text-foreground" title={task.command}>{title}</strong>
        <span class="truncate font-mono text-xs text-muted-foreground" title={task.cwd}>
          {shortenPath(task.cwd, homeDir)} · {readiness}{#if runtimeMeta} · {runtimeMeta}{/if}{#if envMeta} · {envMeta}{/if}
        </span>
      </div>
      <Badge
        size="xs"
        {tone}
        class={tone === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}
      >
        {task.status}
      </Badge>
      <div class="flex shrink-0 items-center gap-0.5">
        <Button size="sm" variant="ghost" class="h-7" onclick={() => onRefresh?.()}>
          <RefreshCw size={13} strokeWidth={2.3} />Refresh
        </Button>
        <Button size="sm" variant="ghost" class="h-7" onclick={() => onRestart?.(task.id)}>
          <RotateCw size={13} strokeWidth={2.3} />Restart
        </Button>
        {#if cancellable}
          <Button size="sm" variant="ghost" class="h-7 text-muted-foreground hover:text-destructive" onclick={() => onCancel?.(task.id)}>
            <Square size={13} strokeWidth={2.3} />{task.status === "orphaned" ? "Clean up" : "Cancel"}
          </Button>
        {/if}
      </div>
    </footer>
  {:else}
    <div class="empty-center">
      <Terminal size={30} strokeWidth={1.7} />
      <p>Task not found.</p>
      <span>The task may have been removed or is no longer available.</span>
    </div>
  {/if}
</section>

<style>
  .task-output-pane {
    display: grid;
    height: 100%;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr) auto;
    background: var(--background);
  }

  .task-output-pane :global(.log-terminal) {
    min-height: 0;
  }

  .empty-center {
    display: grid;
    place-content: center;
    min-height: 100%;
    gap: 0.35rem;
    color: var(--muted-foreground);
    text-align: center;
  }

  .empty-center :global(svg) {
    color: var(--primary);
    justify-self: center;
  }

  .empty-center p {
    margin: 0.25rem 0 0;
    color: var(--foreground);
  }
</style>
