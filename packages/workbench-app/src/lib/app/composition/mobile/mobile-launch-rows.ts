import type { LaunchRecord } from "@nervekit/contracts/launches";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type {
  LaunchDefinitionEntry,
  LaunchRunEntry,
} from "$lib/features/launches/views/launch-panel-types";

/** Phone row decoration for launch runs and the saved launches that start them. */

export type LaunchRowSignal = { tone: StatusTone; pulse: boolean };

const PULSING = new Set<LaunchRecord["status"]>([
  "starting",
  "running",
  "stopping",
]);
const FAILED = new Set<LaunchRecord["status"]>(["failed", "timed_out"]);

export function launchRunSignal(
  status: LaunchRecord["status"],
): LaunchRowSignal {
  if (PULSING.has(status)) return { tone: "info", pulse: true };
  if (status === "ready") return { tone: "success", pulse: false };
  if (FAILED.has(status)) return { tone: "destructive", pulse: false };
  return { tone: "neutral", pulse: false };
}

/** A saved launch shows its latest run's state; one never run shows no dot. */
export function definitionRowSignal(
  entry: Pick<LaunchDefinitionEntry, "latestRun">,
): LaunchRowSignal | undefined {
  return entry.latestRun ? launchRunSignal(entry.latestRun.status) : undefined;
}

/**
 * The second line of a saved-launch row: the command when a name already titles
 * the row, otherwise the folder it runs in when that is not the project root.
 */
export function definitionRowDetail(
  entry: Pick<LaunchDefinitionEntry, "definition">,
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

export function splitRunEntries(runs: readonly LaunchRunEntry[]): {
  running: LaunchRunEntry[];
  recent: LaunchRunEntry[];
} {
  return {
    running: runs.filter((entry) => entry.isActive),
    recent: runs.filter((entry) => !entry.isActive),
  };
}

export function launchStatusLabel(launch: LaunchRecord): string {
  const status = launch.status.replaceAll("_", " ");
  const exit =
    launch.exitCode !== undefined && launch.exitCode !== null
      ? ` · exit ${launch.exitCode}`
      : "";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}${exit}`;
}

/**
 * Finished runs shown on one project's Launches screen, both ad-hoc and those of
 * saved launches. Clearing is scoped to these ids because the server-side prune
 * spans every project.
 */
export function finishedRunIds(view: {
  readonly definitions: readonly Pick<LaunchDefinitionEntry, "runs">[];
  readonly runs: readonly LaunchRunEntry[];
}): string[] {
  return [
    ...view.runs,
    ...view.definitions.flatMap((entry) => entry.runs),
  ].flatMap((entry) => (entry.isRemovable ? [entry.run.id] : []));
}
