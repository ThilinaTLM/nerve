import type { TaskRecord } from "@nervekit/contracts/tasks";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type {
  TaskDefinitionEntry,
  TaskRunEntry,
} from "$lib/features/tasks/views/task-panel-types";

/** Phone row decoration for task runs and the saved tasks that start them. */

export type TaskRowSignal = { tone: StatusTone; pulse: boolean };

const PULSING = new Set<TaskRecord["status"]>([
  "starting",
  "running",
  "stopping",
]);
const FAILED = new Set<TaskRecord["status"]>([
  "failed",
  "timed_out",
  "orphaned",
  "recovery_unknown",
]);

export function taskRunSignal(status: TaskRecord["status"]): TaskRowSignal {
  if (PULSING.has(status)) return { tone: "info", pulse: true };
  if (status === "ready") return { tone: "success", pulse: false };
  if (status === "recovered") return { tone: "warning", pulse: false };
  if (FAILED.has(status)) return { tone: "destructive", pulse: false };
  return { tone: "neutral", pulse: false };
}

/** A saved task shows its latest run's state; one never run shows no dot. */
export function definitionRowSignal(
  entry: Pick<TaskDefinitionEntry, "latestRun">,
): TaskRowSignal | undefined {
  return entry.latestRun ? taskRunSignal(entry.latestRun.status) : undefined;
}

/**
 * The second line of a saved-task row: the command when a name already titles
 * the row, otherwise the folder it runs in when that is not the project root.
 */
export function definitionRowDetail(
  entry: Pick<TaskDefinitionEntry, "definition">,
  projectDir: string | undefined,
): string | undefined {
  const { label, command, cwd } = entry.definition;
  if (label?.trim()) return command;
  const folder = cwd?.trim();
  if (!folder) return undefined;
  const root = projectDir?.replace(/[\\/]+$/, "");
  if (!root) return folder;
  if (folder === root) return undefined;
  for (const separator of ["/", "\\"]) {
    if (folder.startsWith(`${root}${separator}`)) {
      return folder.slice(root.length + 1);
    }
  }
  return folder;
}

export function splitRunEntries(runs: readonly TaskRunEntry[]): {
  running: TaskRunEntry[];
  recent: TaskRunEntry[];
} {
  return {
    running: runs.filter((entry) => entry.isActive),
    recent: runs.filter((entry) => !entry.isActive),
  };
}

export function taskStatusLabel(task: TaskRecord): string {
  const status = task.status.replaceAll("_", " ");
  const exit =
    task.exitCode !== undefined && task.exitCode !== null
      ? ` · exit ${task.exitCode}`
      : "";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}${exit}`;
}

/**
 * Finished runs shown on one project's Tasks screen, both ad-hoc and those of
 * saved tasks. Clearing is scoped to these ids because the server-side prune
 * spans every project.
 */
export function finishedRunIds(view: {
  readonly definitions: readonly Pick<TaskDefinitionEntry, "runs">[];
  readonly runs: readonly TaskRunEntry[];
}): string[] {
  return [
    ...view.runs,
    ...view.definitions.flatMap((entry) => entry.runs),
  ].flatMap((entry) => (entry.isRemovable ? [entry.run.id] : []));
}
