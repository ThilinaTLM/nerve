<script lang="ts">
import { TaskOutputPane } from "@nervekit/workbench-ui/tasks";
import { taskSelectors } from "$lib/features/tasks/state/task-selectors.svelte";

const taskLogs = $derived(taskSelectors.taskLogs);
const activeCenterTask = $derived(taskSelectors.activeCenterTask);
</script>

<TaskOutputPane task={activeCenterTask} {taskLogs} />
