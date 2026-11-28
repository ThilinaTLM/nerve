/**
 * What a script may do with the project's launches: list the catalog
 * (`.nerve/launches/definitions.json`) with each definition's runs, change it through the same
 * service the app uses, and start, restart, stop and read the runs. The host fills ids,
 * timestamps, scope and order, and serializes writes.
 *
 * Every entry is named the way the user sees it in the Launches panel: a definition by its label
 * (or its command when it has none), a folder by its label. Ids (`launchdef_…`,
 * `launchfolder_…`) are accepted too and settle an ambiguous name.
 */

export type LaunchRunPolicy = "single" | "concurrent";

/** One execution of a launch. */
export type LaunchRun = {
  /** "launch_…"; selects this run when a name has several. */
  runId: string;
  name: string;
  /** The command this run executed (the definition may have changed since). */
  command: string;
  status: string;
  readyUrl?: string;
  /** First port the process listens on, when known. */
  port?: number;
  exitCode?: number;
  startedAt: string;
};

export type LaunchEntryDefinition = {
  id: string;
  /** The label, or the command when there is no label: what the user sees. */
  name: string;
  label?: string;
  command: string;
  cwd?: string;
  port?: number;
  runPolicy: LaunchRunPolicy;
  /** Id of the containing folder; null at the top level. */
  folder: string | null;
  order: number;
};

export type LaunchEntryFolder = {
  id: string;
  label: string;
  folder: string | null;
  order: number;
};

export type LaunchesCatalog = {
  definitions: (LaunchEntryDefinition & { runs: LaunchRun[] })[];
  folders: LaunchEntryFolder[];
  /** Runs that belong to no current definition (started by hand, or their definition was deleted). */
  runs: LaunchRun[];
};

/** Fields of a definition the agent decides. `null` clears an optional field on update. */
export type LaunchDefinitionInput = {
  label?: string | null;
  command?: string;
  cwd?: string | null;
  port?: number | null;
  runPolicy?: LaunchRunPolicy;
};

export type LaunchPlacement = {
  /** Folder label or id; omitted or null: the top level. */
  folder?: string | null;
  /** Name or id of the sibling to insert before; omitted: last. */
  before?: string;
};

/** Selects a launch and, optionally, one of its runs. At least one is set. */
export type LaunchSelector = { name?: string; runId?: string };

export type LaunchStartResult = LaunchRun & {
  /** `already_running`: a single-run definition, or the selected run, was still running; nothing was started. */
  outcome: "started" | "already_running";
  /** Set when the definition has a port: whether it listened within 30 s. */
  listening?: boolean;
  /** Set with `waitFor`: whether the run's output matched. */
  matched?: boolean;
  /** Set with `waitFor`: the log's tail (at most 100 lines) up to the matching line. */
  output?: string;
};

/** A start resolved before it is authorized: the exact command that runs. */
export type PreparedLaunchStart = {
  name: string;
  /** Absent when nothing would be spawned (the selected run is still running). `cwd` is relative to the project, absent at its root, absolute outside it. */
  process?: { command: string; cwd?: string };
  start(): Promise<LaunchStartResult>;
};

/** A stop resolved before it is authorized. */
export type PreparedLaunchStop = {
  name: string;
  /** `launches:launch/<definition id>`, or `launches:run/<run id>` for a run of no definition. */
  target: string;
  stop(): Promise<{ stopped: boolean; run?: LaunchRun }>;
};

export interface LaunchesAgentPort {
  list(): Promise<LaunchesCatalog>;
  create(
    input: LaunchDefinitionInput & { command: string } & LaunchPlacement,
  ): Promise<LaunchEntryDefinition>;
  update(
    name: string,
    input: LaunchDefinitionInput,
  ): Promise<LaunchEntryDefinition>;
  remove(name: string): Promise<{ ok: true }>;
  createFolder(
    input: { label: string } & LaunchPlacement,
  ): Promise<LaunchEntryFolder>;
  move(name: string, placement: LaunchPlacement): Promise<{ ok: true }>;
  prepareStart(
    selector: LaunchSelector,
    mode: "start" | "restart",
  ): Promise<PreparedLaunchStart>;
  prepareStop(selector: LaunchSelector): Promise<PreparedLaunchStop>;
  logs(
    selector: LaunchSelector,
    page: { offset?: number; limit?: number },
  ): Promise<{ run: LaunchRun; output: string }>;
  /** The run's whole log as written, with no paging text, and its current state; the wait for output polls it. */
  readOutput(runId: string): Promise<{ run: LaunchRun; text: string }>;
}
