<script lang="ts">
import type { ProjectRecord, TaskRecord } from "$lib/api";
import type { CancelTaskRequest } from "@nervekit/contracts";
import { createWorkbenchTaskPanelAdapter } from "$lib/features/tasks/state/workbench-task-panel-adapter.svelte";
import { TasksPanel } from "$lib/features/tasks";

type Props = {
  activeProject?: ProjectRecord;
  tasks?: TaskRecord[];
  selectedTask?: TaskRecord;
  homeDir?: string;
  onOpenTaskOutput?: (id: string) => void;
  onCancelTask?: (id: string, request?: CancelTaskRequest) => void;
  onRestartTask?: (id: string) => void;
  onRemoveTask?: (id: string) => void;
  onCleanupRuns?: (ids: readonly string[]) => void;
  onPruneTasks?: () => void;
  onRunCommand?: (input: {
    projectId: string;
    cwd: string;
    command: string;
    name?: string;
  }) => void;
};

let {
  activeProject,
  tasks = [],
  selectedTask,
  onOpenTaskOutput,
  onCancelTask,
  onRestartTask,
  onRemoveTask,
  onCleanupRuns,
  onPruneTasks,
  onRunCommand,
}: Props = $props();

const adapter = createWorkbenchTaskPanelAdapter(
  () => activeProject,
  () => tasks,
  () => selectedTask,
  {
    openTaskOutput: (id) => onOpenTaskOutput?.(id),
    cancelTask: (id, request) => onCancelTask?.(id, request),
    restartTask: (id) => onRestartTask?.(id),
    removeTask: (id) => onRemoveTask?.(id),
    cleanupRuns: (ids) => onCleanupRuns?.(ids),
    pruneTasks: () => onPruneTasks?.(),
    runCommand: (input) => onRunCommand?.(input),
  },
);
</script>

<TasksPanel model={adapter.model} actions={adapter.actions} />
