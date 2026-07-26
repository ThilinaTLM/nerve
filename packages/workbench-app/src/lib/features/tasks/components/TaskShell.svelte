<script lang="ts">
import { TaskOutputPane } from "@nervekit/workbench-ui/tasks";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  loadEarlierTaskLogs,
  loadTaskLogWindow,
  searchTaskLogHistory,
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
const historySearch = $derived(
  taskState.logHistorySearch?.taskId === activeCenterTask?.id
    ? taskState.logHistorySearch
    : undefined,
);
const historyNotice = $derived(
  historySearch
    ? `History search: ${historySearch.text}${
        historySearch.truncated ? " (showing newest matches)" : ""
      }`
    : undefined,
);

async function copyOutput(text: string): Promise<void> {
  try {
    await writeClipboardText(text);
    notify.success("Copied task output");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
</script>

<TaskOutputPane
  task={activeCenterTask}
  {taskLogs}
  {runs}
  {historyNotice}
  searchingHistory={taskState.logHistorySearching}
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
  onSearchHistory={(filter) => {
    if (!activeCenterTask) return;
    void searchTaskLogHistory(activeCenterTask.id, filter);
  }}
  onBackToLive={() => {
    if (!activeCenterTask) return;
    void loadTaskLogWindow(activeCenterTask.id);
  }}
  onCopyOutput={(text) => void copyOutput(text)}
/>
