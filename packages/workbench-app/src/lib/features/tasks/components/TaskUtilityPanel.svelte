<script lang="ts">
import type { ProjectRecord, TaskRecord } from "$lib/api";
import { createWorkbenchTaskPanelAdapter } from "$lib/features/tasks/state/workbench-task-panel-adapter.svelte";
import {
  TaskUtilityPanelView,
  type TaskPanelSectionState,
} from "@nervekit/workbench-ui";
import { utilitySectionPreferences } from "$lib/app/layout/utility-section-preferences.svelte";

type Props = {
  activeProject?: ProjectRecord;
  tasks?: TaskRecord[];
  selectedTask?: TaskRecord;
  homeDir?: string;
  onOpenTaskOutput?: (id: string) => void;
  onCancelTask?: (id: string) => void;
  onRestartTask?: (id: string) => void;
  onRemoveTask?: (id: string) => void;
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
  onPruneTasks,
  onRunCommand,
}: Props = $props();

const adapter = createWorkbenchTaskPanelAdapter(
  () => activeProject,
  () => tasks,
  () => selectedTask,
  {
    openTaskOutput: (id) => onOpenTaskOutput?.(id),
    cancelTask: (id) => onCancelTask?.(id),
    restartTask: (id) => onRestartTask?.(id),
    removeTask: (id) => onRemoveTask?.(id),
    pruneTasks: () => onPruneTasks?.(),
    runCommand: (input) => onRunCommand?.(input),
  },
);
const sectionState = $derived<TaskPanelSectionState>({
  pinned: utilitySectionPreferences.isOpen("tasks.pinned"),
  running: utilitySectionPreferences.isOpen("tasks.running"),
  needsCleanup: utilitySectionPreferences.isOpen("tasks.needsCleanup"),
  finished: utilitySectionPreferences.isOpen("tasks.finished"),
});
</script>

<TaskUtilityPanelView
  model={adapter.model}
  actions={adapter.actions}
  {sectionState}
  onSectionOpenChange={(section, open) =>
    utilitySectionPreferences.setOpen(`tasks.${section}`, open)}
/>
