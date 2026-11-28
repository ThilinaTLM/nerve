/** Declarations of the `launches` runtime namespace. */
export const LAUNCHES_DTS_TYPES = `interface LaunchDefinition {
  /** "launchdef_...". */
  id: string;
  /** The label, or the command when there is no label: what the user sees, and what \`name\` arguments match. */
  name: string;
  label?: string;
  command: string;
  /** Relative to the project directory. */
  cwd?: string;
  port?: number;
  runPolicy: "single" | "concurrent";
  /** Containing folder id; null at the top level. */
  folder: string | null;
  /** Position among siblings, 0..n-1. */
  order: number;
}
interface LaunchRun {
  /** "launch_...". */
  runId: string;
  name: string;
  /** The command this run executed; the definition may have changed since. */
  command: string;
  /** starting, running, ready, stopping, completed, failed, cancelled, timed_out, ... */
  status: string;
  readyUrl?: string;
  /** First port the process listens on, when known. */
  port?: number;
  exitCode?: number;
  startedAt: string;
}
/** The label shown in the Launches panel (the command when unlabeled), or an id from list(). */
type LaunchName = string;
interface LaunchRunRef {
  name?: LaunchName;
  /** Picks one run of that name; alone, it selects the run directly. */
  runId?: string;
}
interface LaunchWaitOptions {
  /** A string is matched literally. The call returns when the run's output matches, the run exits or \`timeout\` passes, and adds \`matched\` and \`output\`. Only the started run's output counts. */
  waitFor?: RegExp | string;
  /** Seconds; default 60, max 600. A timeout is not an error: \`matched\` is false. */
  timeout?: number;
}
interface LaunchStartResult extends LaunchRun {
  /** already_running: nothing was started. */
  outcome: "started" | "already_running";
  /** Only for definitions with a port: whether it listened within 30 s. */
  listening?: boolean;
  /** Only with \`waitFor\`: whether the run's output matched; false when it exited or timed out first. */
  matched?: boolean;
  /** Only with \`waitFor\`: log tail (at most 100 lines) up to the matching line. */
  output?: string;
}
interface LaunchFolder {
  /** "launchfolder_...". */
  id: string;
  label: string;
  folder: string | null;
  order: number;
}
interface LaunchesCatalog {
  /** runs: latest first. */
  definitions: (LaunchDefinition & { runs: LaunchRun[] })[];
  folders: LaunchFolder[];
  /** Runs of no current definition (started by hand, or their definition was deleted). */
  runs: LaunchRun[];
}
interface LaunchPlacement {
  /** Folder label or id; omit or null for the top level. */
  folder?: string | null;
  /** Name or id of the sibling (definition or folder, same \`folder\`) to insert before; omit to append. */
  before?: string;
}
interface LaunchDefinitionFields {
  label?: string;
  /** Shell command. There is no env field: write variables into the command (\`PORT=3000 pnpm dev\`). */
  command: string;
  cwd?: string;
  port?: number;
  /** Default "single". */
  runPolicy?: "single" | "concurrent";
}`;
