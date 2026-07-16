<script lang="ts">
import { TaskOutputPane } from "@nervekit/workbench-ui/tasks";
import { loadEarlierTaskLogs } from "$lib/features/tasks/state/task-logs.svelte";
import { taskSelectors } from "$lib/features/tasks/state/task-selectors.svelte";

const activeCenterTask = $derived(taskSelectors.activeCenterTask);
const taskLogs = $derived(
  taskSelectors.taskLogs?.task.id === activeCenterTask?.id
    ? taskSelectors.taskLogs
    : undefined,
);
</script>

<TaskOutputPane
  task={activeCenterTask}
  {taskLogs}
  onLoadEarlier={() =>
    activeCenterTask
      ? loadEarlierTaskLogs(activeCenterTask.id)
      : Promise.resolve()}
/>
