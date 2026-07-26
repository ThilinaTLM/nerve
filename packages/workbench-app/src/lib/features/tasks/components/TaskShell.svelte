<script lang="ts">
import { TaskOutputPane } from "@nervekit/workbench-ui/tasks";
import {
  loadEarlierTaskLogs,
  loadTaskLogWindow,
} from "$lib/features/tasks/state/task-logs.svelte";
import {
  setTaskEntryRun,
  taskEntryKey,
} from "$lib/features/tasks/state/task-tabs.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import { taskSelectors } from "$lib/features/tasks/state/task-selectors.svelte";

const activeCenterTask = $derived(taskSelectors.activeCenterTask);
const runs = $derived(
  activeCenterTask
    ? taskState.tasks.filter(
        (task) => taskEntryKey(task.id) === taskEntryKey(activeCenterTask.id),
      )
    : [],
);
const taskLogs = $derived(
  taskSelectors.taskLogs?.task.id === activeCenterTask?.id
    ? taskSelectors.taskLogs
    : undefined,
);
</script>

<TaskOutputPane
  task={activeCenterTask}
  {taskLogs}
  {runs}
  onSelectRun={(taskId) => {
    if (!activeCenterTask) return;
    setTaskEntryRun(taskEntryKey(activeCenterTask.id), taskId);
    taskState.selectedTaskId = taskId;
    void loadTaskLogWindow(taskId);
  }}
  onLoadEarlier={() =>
    activeCenterTask
      ? loadEarlierTaskLogs(activeCenterTask.id)
      : Promise.resolve()}
/>
