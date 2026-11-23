import { parseOptions } from "@nervekit/extension-api/host";
import { codedError } from "../errors.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkMethod } from "../sdk-types.js";
import type {
  LaunchDefinitionInput,
  LaunchPlacement,
  LaunchSelector,
} from "./launches-port.js";

function port(env: Parameters<SdkMethod["prepare"]>[1]) {
  const agent = env.context.launchesAgent;
  if (!agent)
    throw codedError(
      "FORBIDDEN",
      "This run cannot use the project's launches (no launches port).",
    );
  return agent;
}

const TARGET = "launches:catalog/project";

function text(
  options: Record<string, unknown>,
  name: string,
): string | undefined;
function text(
  options: Record<string, unknown>,
  name: string,
  nullable: true,
): string | null | undefined;
function text(
  options: Record<string, unknown>,
  name: string,
  nullable = false,
): string | null | undefined {
  const value = options[name];
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (typeof value !== "string")
    throw new Error(`${name} must be a string${nullable ? " or null" : ""}.`);
  return value;
}

function name(options: Record<string, unknown>): string {
  const value = text(options, "name");
  if (!value?.trim())
    throw new Error(
      "name is required: the label shown in the Launches panel, or an id from launches.list().",
    );
  return value;
}

function selector(options: Record<string, unknown>): LaunchSelector {
  const launch = text(options, "name");
  const runId = text(options, "runId");
  if (!launch?.trim() && !runId?.trim())
    throw new Error(
      "name is required (the label shown in the Launches panel), or a runId from launches.list().",
    );
  return {
    ...(launch?.trim() ? { name: launch } : {}),
    ...(runId?.trim() ? { runId } : {}),
  };
}

function page(options: Record<string, unknown>) {
  const { offset, lines } = options;
  if (offset !== undefined && (!Number.isInteger(offset) || Number(offset) < 0))
    throw new Error("offset must be an integer of 0 or more.");
  if (
    lines !== undefined &&
    (!Number.isInteger(lines) || Number(lines) < 1 || Number(lines) > 500)
  )
    throw new Error("lines must be an integer from 1 to 500.");
  return {
    offset: offset as number | undefined,
    limit: lines as number | undefined,
  };
}

const label = (target: LaunchSelector) =>
  target.name !== undefined
    ? JSON.stringify(target.name)
    : `run ${target.runId}`;

function fields(options: Record<string, unknown>): LaunchDefinitionInput {
  const { port: portValue, runPolicy } = options;
  if (
    portValue !== undefined &&
    portValue !== null &&
    typeof portValue !== "number"
  )
    throw new Error("port must be a number or null.");
  if (
    runPolicy !== undefined &&
    runPolicy !== "single" &&
    runPolicy !== "concurrent"
  )
    throw new Error('runPolicy must be "single" or "concurrent".');
  return {
    label: text(options, "label", true),
    command: text(options, "command"),
    cwd: text(options, "cwd", true),
    port: portValue,
    runPolicy: runPolicy,
  };
}

function placement(options: Record<string, unknown>): LaunchPlacement {
  return {
    folder: text(options, "folder", true),
    before: text(options, "before"),
  };
}

const FIELD_OPTIONS = ["label", "command", "cwd", "port", "runPolicy"] as const;
const PLACE_OPTIONS = ["folder", "before"] as const;
const SELECT_OPTIONS = ["name", "runId"] as const;
const WRITES =
  "Writes the project's launch catalog through Nerve (locking, ids and order are handled); never edit definitions.json by hand. If the file on disk is invalid, the call fails and says how to fix it.";
const NAMES =
  "`name`: the label shown in the Launches panel (the command when unlabeled), or an id from list().";
const RUN =
  "`runId` picks one run of that name; alone, it selects the run directly.";

const describe = (
  command: string | undefined,
  label: string | null | undefined,
) => JSON.stringify(label ?? command ?? "");

/** `start` and `restart`: resolved first, then checked as the bash command they run. */
function startMethod(mode: "start" | "restart"): SdkMethod {
  const method = `launches.${mode}`;
  return {
    product: "launches",
    path: mode,
    // Checked as the bash call it runs, which may be destructive.
    risk: "destructive",
    directTool: "bash",
    signature:
      mode === "start"
        ? `/** Start a launch definition (or a stopped run). ${NAMES} Checked like the bash command it runs. A single-run definition that is already running is not started twice. With a port, waits up to 30 s for it to listen. Runs keep going after the script ends; you are notified when one you started exits. */ start(name: string | { name?: string; runId?: string }): Promise<LaunchStartResult>`
        : `/** Stop the launch's current run (if any) and start it again with the definition's current command. ${NAMES} ${RUN} Checked like the bash command it runs. */ restart(name: string | { name?: string; runId?: string }): Promise<LaunchStartResult>`,
    async prepare(args, env) {
      const target = selector(
        parseOptions(method, args, { bare: "name", options: SELECT_OPTIONS }),
      );
      const prepared = await port(env).prepareStart(target, mode);
      return {
        ...(prepared.process
          ? {
              authorization: {
                toolName: "bash",
                args: {
                  command: prepared.process.command,
                  ...(prepared.process.cwd !== undefined
                    ? { cwd: prepared.process.cwd }
                    : {}),
                },
                summary: `${mode === "start" ? "Start" : "Restart"} launch ${JSON.stringify(prepared.name)}: ${prepared.process.command}${prepared.process.cwd !== undefined ? ` (in ${prepared.process.cwd})` : ""}`,
              },
            }
          : {}),
        resource: `launch ${JSON.stringify(prepared.name)}`,
        run: () => prepared.start(),
      };
    },
  };
}

/**
 * `launches.*`: the project's launches. Catalog writes go through `LaunchDefinitionService`, so
 * the agent never edits `definitions.json` or renumbers `order` itself; starts are checked as
 * the bash command they run.
 */
export const launchesMethods: SdkMethod[] = [
  defineMethod({
    product: "launches",
    path: "list",
    risk: "read",
    options: [],
    signature:
      "/** The project's launch definitions with their runs (latest first), folders, and runs of no current definition. Fails with the fix when definitions.json is invalid. */ list(): Promise<LaunchesCatalog>",
    parse: () => undefined,
    resource: () => "launches",
    run: async (_, env) => await port(env).list(),
  }),
  startMethod("start"),
  startMethod("restart"),
  {
    product: "launches",
    path: "stop",
    risk: "external_write",
    signature: `/** Stop the launch's latest run. ${NAMES} ${RUN} \`stopped\` is false when nothing was running. */ stop(name: string | { name?: string; runId?: string }): Promise<{ stopped: boolean; run?: LaunchRun }>`,
    async prepare(args, env) {
      const prepared = await port(env).prepareStop(
        selector(
          parseOptions("launches.stop", args, {
            bare: "name",
            options: SELECT_OPTIONS,
          }),
        ),
      );
      return {
        authorization: {
          operation: "launches.stop",
          targets: [{ kind: "resource", value: prepared.target }],
          risk: "external_write",
          summary: `Stop launch ${JSON.stringify(prepared.name)}`,
        },
        resource: `launch ${JSON.stringify(prepared.name)}`,
        run: () => prepared.stop(),
      };
    },
  },
  defineMethod({
    product: "launches",
    path: "logs",
    risk: "read",
    bare: "name",
    options: [...SELECT_OPTIONS, "offset", "lines"],
    signature: `/** Output of the launch's latest run: \`lines\` lines (default 100, max 500) from \`offset\` (0-based; default: the tail). ${NAMES} ${RUN} */ logs(name: string | { name?: string; runId?: string; offset?: number; lines?: number }): Promise<{ run: LaunchRun; output: string }>`,
    parse: (options) => ({ target: selector(options), page: page(options) }),
    resource: ({ target }) => `launch ${label(target)}`,
    run: async ({ target, page: lines }, env) =>
      await port(env).logs(target, lines),
  }),
  defineMethod({
    product: "launches",
    path: "create",
    risk: "write",
    options: [...FIELD_OPTIONS, ...PLACE_OPTIONS],
    signature: `/** Add a launch definition. ${WRITES} Give each definition a distinct label: it is how you and the user name it. Returns the definition. */ create(options: LaunchDefinitionFields & LaunchPlacement): Promise<LaunchDefinition>`,
    parse: (options) => {
      const input = fields(options);
      if (!input.command)
        throw new Error('command is required, e.g. { command: "pnpm dev" }.');
      return { ...input, ...placement(options), command: input.command };
    },
    authorize: (input) => ({
      targets: [TARGET],
      summary: `Create launch ${describe(input.command, input.label)}: ${input.command}`,
    }),
    resource: () => "launch definitions",
    run: async (input, env) => await port(env).create(input),
  }),
  defineMethod({
    product: "launches",
    path: "update",
    risk: "write",
    options: ["name", ...FIELD_OPTIONS],
    signature: `/** Change a definition: fields you omit stay; null clears label, cwd or port. ${NAMES} ${WRITES} */ update(options: { name: string; command?: string; label?: string | null; cwd?: string | null; port?: number | null; runPolicy?: "single" | "concurrent" }): Promise<LaunchDefinition>`,
    parse: (options) => ({ name: name(options), input: fields(options) }),
    authorize: ({ name: target, input }) => ({
      targets: [TARGET],
      summary: `Update launch ${JSON.stringify(target)}${input.command ? `: ${input.command}` : ""}`,
    }),
    resource: ({ name: target }) => `launch ${JSON.stringify(target)}`,
    run: async ({ name: target, input }, env) =>
      await port(env).update(target, input),
  }),
  defineMethod({
    product: "launches",
    path: "remove",
    risk: "write",
    bare: "name",
    options: ["name"],
    signature: `/** Delete a definition; its runs keep going. ${NAMES} ${WRITES} */ remove(name: string | { name: string }): Promise<{ ok: true }>`,
    parse: (options) => name(options),
    authorize: (target) => ({
      targets: [TARGET],
      summary: `Remove launch ${JSON.stringify(target)}`,
    }),
    resource: (target) => `launch ${JSON.stringify(target)}`,
    run: async (target, env) => await port(env).remove(target),
  }),
  defineMethod({
    product: "launches",
    path: "folders.create",
    risk: "write",
    options: ["label", ...PLACE_OPTIONS],
    signature: `/** Add a folder; its label is unique among sibling folders, ignoring case. ${WRITES} */ create(options: { label: string } & LaunchPlacement): Promise<LaunchFolder>`,
    parse: (options) => {
      const label = text(options, "label");
      if (!label?.trim()) throw new Error("label is required.");
      return { label, ...placement(options) };
    },
    authorize: (input) => ({
      targets: [TARGET],
      summary: `Create launch folder ${JSON.stringify(input.label)}`,
    }),
    resource: () => "launch folders",
    run: async (input, env) => await port(env).createFolder(input),
  }),
  defineMethod({
    product: "launches",
    path: "move",
    risk: "write",
    options: ["name", ...PLACE_OPTIONS],
    signature: `/** Move a definition or folder (\`name\`: its label or id) into a folder (null: top level), before a sibling or last. ${WRITES} */ move(options: { name: string } & LaunchPlacement): Promise<{ ok: true }>`,
    parse: (options) => ({ name: name(options), ...placement(options) }),
    authorize: ({ name: target }) => ({
      targets: [TARGET],
      summary: `Move launch entry ${JSON.stringify(target)}`,
    }),
    resource: ({ name: target }) => `launch ${JSON.stringify(target)}`,
    run: async ({ name: target, ...place }, env) =>
      await port(env).move(target, place),
  }),
];
