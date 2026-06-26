<script lang="ts">
  import TaskOutputPane from "$lib/features/tasks/components/TaskOutputPane.svelte";
  import { taskSelectors } from "$lib/features/tasks/state/task-selectors.svelte";

  const taskLogs = $derived(taskSelectors.taskLogs);
  const activeCenterTask = $derived(taskSelectors.activeCenterTask);
</script>

<TaskOutputPane task={activeCenterTask} {taskLogs} />
