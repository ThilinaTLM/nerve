<script lang="ts">
import { untrack } from "svelte";
import Copy from "@lucide/svelte/icons/copy";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import Eraser from "@lucide/svelte/icons/eraser";
import History from "@lucide/svelte/icons/history";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Skull from "@lucide/svelte/icons/skull";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import { MobileActionSheet, MobileScreen } from "$lib/presentation/shell";
import {
  cancelSelectedTask,
  cleanupTaskRuns,
  formatTaskRunTime,
  restartSelectedTask,
  siblingTaskRuns,
  taskSelectors,
  toRunEntry,
} from "$lib/features/tasks";
import TaskLogTerminal from "$lib/features/tasks/views/TaskLogTerminal.svelte";
import { loadEarlierTaskLogs } from "$lib/features/tasks/state/task-logs.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { taskTitle } from "$lib/app/shell/mobile/mobile-activity";
import { activateMobileRoute } from "$lib/app/shell/mobile/mobile-route-activation.svelte";
import {
  backFromMobileScreen,
  replaceMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";
import { taskStatusLabel } from "./mobile-task-rows";

/**
 * One task run's output as a phone screen. Other runs of the same task are a
 * sheet away instead of the desktop's floating run switcher.
 */
let { route, visible }: MobileScreenProps<"task"> = $props();

const task = $derived(
  taskSelectors.tasks.find((candidate) => candidate.id === route.taskId),
);
const entry = $derived(task ? toRunEntry(task) : undefined);
const siblings = $derived(siblingTaskRuns(taskSelectors.tasks, route.taskId));
const staleRuns = $derived(
  siblings.filter(
    (run) => run.id !== route.taskId && toRunEntry(run).isRemovable,
  ),
);
const taskLogs = $derived(
  taskSelectors.taskLogs?.task.id === route.taskId
    ? taskSelectors.taskLogs
    : undefined,
);

// Route activation shows the run when the screen surfaces; a run that was not
// loaded yet (e.g. after a reload) is shown once it arrives.
let shown = untrack(() => Boolean(task));
$effect(() => {
  const exists = Boolean(task);
  if (!visible || !exists || shown) return;
  shown = true;
  untrack(() => void activateMobileRoute(route));
});

let menuOpen = $state(false);
let runsOpen = $state(false);
let cleanupOpen = $state(false);
let forceKillOpen = $state(false);

function failed(action: string) {
  return (error: unknown) =>
    notify.error(
      `Could not ${action}: ${error instanceof Error ? error.message : String(error)}`,
    );
}

function showRun(taskId: string) {
  if (taskId === route.taskId) return;
  replaceMobileScreen({ ...route, taskId });
}

// A restart's new run joins this run's entry once the task list catches up;
// the screen then follows it.
let followNewerRun = $state(false);
$effect(() => {
  if (!followNewerRun || !task) return;
  const newest = siblings[0];
  if (!newest || newest.startedAt <= task.startedAt) return;
  followNewerRun = false;
  untrack(() => showRun(newest.id));
});

async function restart() {
  if (!task) return;
  try {
    followNewerRun = true;
    await restartSelectedTask(task.id);
  } catch (error) {
    followNewerRun = false;
    failed("restart task")(error);
  }
}

function stop() {
  if (task) void cancelSelectedTask(task.id).catch(failed("stop task"));
}

function forceKill() {
  if (!task) return;
  void cancelSelectedTask(task.id, {
    signal: "SIGKILL",
    reason: "force_kill",
  }).catch(failed("force kill task"));
}

async function copyCommand() {
  if (!task) return;
  try {
    await writeClipboardText(task.command);
    notify.success("Copied to clipboard");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

const menu = $derived.by<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [];
  if (entry?.isActive && entry.canForceKill) {
    items.push({
      label: "Force kill",
      icon: Skull,
      destructive: true,
      onSelect: () => (forceKillOpen = true),
    });
  }
  if (siblings.length > 1) {
    items.push({
      label: `Other runs (${siblings.length - 1})`,
      icon: History,
      onSelect: () => (runsOpen = true),
    });
  }
  if (staleRuns.length) {
    items.push({
      label: "Clean up old runs",
      icon: Eraser,
      onSelect: () => (cleanupOpen = true),
    });
  }
  items.push({ label: "Copy command", icon: Copy, onSelect: copyCommand });
  return items;
});

const runItems = $derived<ContextMenuItem[]>(
  siblings.map((run) => ({
    label: `${taskStatusLabel(run)} · ${formatTaskRunTime(run.startedAt)}${run.id === route.taskId ? " (shown)" : ""}`,
    icon: Terminal,
    disabled: run.id === route.taskId,
    onSelect: () => showRun(run.id),
  })),
);
</script>

<MobileScreen
  title={task ? taskTitle(task) : "Task"}
  subtitle={task
    ? `${taskStatusLabel(task)} · ${relativeTimeLabel(task.startedAt)}`
    : undefined}
  onBack={backFromMobileScreen}
  scroll={false}
>
  {#snippet actions()}
    {#if entry?.isActive}
      <Button variant="ghost" size="icon-sm" ariaLabel="Stop" onclick={stop}>
        <Square size={17} strokeWidth={1.9} />
      </Button>
    {:else if task}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Restart"
        onclick={() => void restart()}
      >
        <RotateCcw size={18} strokeWidth={1.9} />
      </Button>
    {/if}
    {#if task}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Task output actions"
        onclick={() => (menuOpen = true)}
      >
        <EllipsisVertical size={18} strokeWidth={1.9} />
      </Button>
    {/if}
  {/snippet}

  {#if task}
    <div class="flex min-h-0 flex-col">
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
            onLoadEarlier={() => loadEarlierTaskLogs(route.taskId)}
          />
        {/key}
      </div>
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
</MobileScreen>

<MobileActionSheet
  open={menuOpen}
  title={task ? taskTitle(task) : "Task"}
  items={menu}
  onOpenChange={(open) => (menuOpen = open)}
/>

<MobileActionSheet
  open={runsOpen}
  title="Runs"
  items={runItems}
  onOpenChange={(open) => (runsOpen = open)}
/>

<ConfirmDialog
  bind:open={cleanupOpen}
  destructive
  title="Clean up old runs?"
  description={`Removes ${staleRuns.length === 1 ? "1 finished run" : `${staleRuns.length} finished runs`} of this task and their output.`}
  confirmLabel="Clean up"
  onConfirm={() =>
    void cleanupTaskRuns(staleRuns.map((run) => run.id)).catch(
      failed("clean up runs"),
    )}
/>

<ConfirmDialog
  bind:open={forceKillOpen}
  destructive
  title="Force kill task?"
  description="Immediately terminates the process. Buffered output and process cleanup may be lost."
  confirmLabel="Force kill"
  onConfirm={forceKill}
/>
