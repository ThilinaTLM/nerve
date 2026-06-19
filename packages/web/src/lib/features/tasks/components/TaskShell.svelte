<script lang="ts">
  import TaskOutputPane from "$lib/features/tasks/components/TaskOutputPane.svelte";
  import { taskSelectors } from "$lib/features/tasks/state/task-selectors.svelte";
  import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
  import {
    refreshTaskLogs,
    restartSelectedTask,
    cancelSelectedTask,
  } from "$lib/features/tasks/state/tasks.svelte";

  const status = $derived(workspaceSelectors.status);
  const taskLogs = $derived(taskSelectors.taskLogs);
  const activeCenterTask = $derived(taskSelectors.activeCenterTask);
</script>

<TaskOutputPane
  task={activeCenterTask}
  {taskLogs}
  homeDir={status?.storage.home}
  onRefresh={() => void refreshTaskLogs()}
  onRestart={(id) => void restartSelectedTask(id)}
  onCancel={(id) => void cancelSelectedTask(id)}
/>
