<script lang="ts">
import TasksPanelHost from "$lib/features/tasks/hosts/TasksPanelHost.svelte";
import {
  cancelSelectedTask,
  cleanupTaskRuns,
  openTaskTab,
  pruneFinishedTasks,
  removeTask,
  restartSelectedTask,
  runTaskCommand,
  taskSelectors,
} from "$lib/features/tasks";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  activatePanelView,
  revealPanelView,
} from "$lib/app/shell/shell-layout.svelte";
import { responsive } from "$lib/app/shell/responsive.svelte";

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
const tasks = $derived(taskSelectors.scopedTasks);
const selectedTask = $derived(taskSelectors.activeCenterTask);

function focusTasks() {
  revealPanelView("tasks", responsive.isCompact);
  activatePanelView("tasks");
}
</script>

<TasksPanelHost
  {activeProject}
  {tasks}
  {selectedTask}
  homeDir={status?.storage.userHome}
  onOpenTaskOutput={(id) => {
    focusTasks();
    void openTaskTab(id);
  }}
  onCancelTask={(id, request) => void cancelSelectedTask(id, request)}
  onRestartTask={(id) => void restartSelectedTask(id)}
  onRemoveTask={(id) => void removeTask(id)}
  onCleanupRuns={(ids) => void cleanupTaskRuns(ids)}
  onPruneTasks={() => void pruneFinishedTasks()}
  onRunCommand={(input) => {
    focusTasks();
    void runTaskCommand(input);
  }}
/>
