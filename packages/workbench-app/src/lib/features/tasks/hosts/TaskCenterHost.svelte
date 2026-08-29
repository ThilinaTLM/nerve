<script lang="ts">
import { TaskOutputPane } from "$lib/features/tasks/views";
import { loadEarlierTaskLogs } from "$lib/features/tasks/state/task-logs.svelte";
import {
  cancelSelectedTask,
  cleanupTaskRuns,
  restartSelectedTask,
} from "$lib/features/tasks/state/tasks.svelte";
import { taskSelectors } from "$lib/features/tasks/state/task-selectors.svelte";
import {
  selectTaskEntryRun,
  taskEntryKey,
} from "$lib/features/tasks/state/task-tabs.svelte";

const activeCenterTask = $derived(taskSelectors.activeCenterTask);
const siblingRuns = $derived(taskSelectors.activeCenterTaskRuns);
const taskLogs = $derived(
  taskSelectors.taskLogs?.task.id === activeCenterTask?.id
    ? taskSelectors.taskLogs
    : undefined,
);
</script>

<TaskOutputPane
  task={activeCenterTask}
  {taskLogs}
  {siblingRuns}
  onSelectRun={(taskId) =>
    activeCenterTask
      ? selectTaskEntryRun(taskEntryKey(activeCenterTask.id), taskId)
      : Promise.resolve()}
  onRestartRun={(taskId) => restartSelectedTask(taskId)}
  onCancelRun={(taskId) => cancelSelectedTask(taskId)}
  onForceKillRun={(taskId) =>
    cancelSelectedTask(taskId, {
      signal: "SIGKILL",
      reason: "force_kill",
    })}
  onCleanupRuns={(taskIds) => cleanupTaskRuns(taskIds)}
  onLoadEarlier={() =>
    activeCenterTask
      ? loadEarlierTaskLogs(activeCenterTask.id)
      : Promise.resolve()}
/>
