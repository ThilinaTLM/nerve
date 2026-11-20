import { codedError } from "../errors.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkMethod } from "../sdk-types.js";
import type {
  LaunchDefinitionInput,
  LaunchPlacement,
} from "./launches-port.js";

function port(env: Parameters<SdkMethod["prepare"]>[1]) {
  const agent = env.context.launchesAgent;
  if (!agent)
    throw codedError(
      "FORBIDDEN",
      "This run cannot change launch definitions (no launches port).",
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

function id(options: Record<string, unknown>, name = "id"): string {
  const value = text(options, name);
  if (!value)
    throw new Error(`${name} is required (an id from launches.list()).`);
  return value;
}

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
const WRITES =
  "Writes the project's launch catalog through Nerve (locking, ids and order are handled); never edit definitions.json by hand. If the file on disk is invalid, the call fails and says how to fix it.";

const describe = (
  command: string | undefined,
  label: string | null | undefined,
) => JSON.stringify(label ?? command ?? "");

/**
 * `launches.*`: the project's launch catalog. Writes go through `LaunchDefinitionService`, so the
 * agent never edits `definitions.json` or renumbers `order` itself.
 */
export const launchesMethods: SdkMethod[] = [
  defineMethod({
    product: "launches",
    path: "list",
    risk: "read",
    options: [],
    signature:
      "/** The project's launch definitions and folders with their ids. Start one with the `launch` tool. Fails with the fix when definitions.json is invalid. */ list(): Promise<LaunchesCatalog>",
    parse: () => undefined,
    resource: () => "launch definitions",
    run: async (_, env) => await port(env).list(),
  }),
  defineMethod({
    product: "launches",
    path: "create",
    risk: "write",
    options: [...FIELD_OPTIONS, ...PLACE_OPTIONS],
    signature: `/** Add a launch definition. ${WRITES} Give each definition a distinct label. Returns the definition with its id. */ create(options: LaunchDefinitionFields & LaunchPlacement): Promise<LaunchDefinition>`,
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
    options: ["id", ...FIELD_OPTIONS],
    signature: `/** Change a definition: fields you omit stay; null clears label, cwd or port. ${WRITES} */ update(options: { id: string; command?: string; label?: string | null; cwd?: string | null; port?: number | null; runPolicy?: "single" | "concurrent" }): Promise<LaunchDefinition>`,
    parse: (options) => ({ id: id(options), input: fields(options) }),
    authorize: ({ id: target, input }) => ({
      targets: [TARGET],
      summary: `Update launch ${target}${input.command ? `: ${input.command}` : ""}`,
    }),
    resource: ({ id: target }) => `launch ${target}`,
    run: async ({ id: target, input }, env) =>
      await port(env).update(target, input),
  }),
  defineMethod({
    product: "launches",
    path: "remove",
    risk: "write",
    bare: "id",
    options: ["id"],
    signature: `/** Delete a definition. ${WRITES} */ remove(id: string | { id: string }): Promise<{ ok: true }>`,
    parse: (options) => id(options),
    authorize: (target) => ({
      targets: [TARGET],
      summary: `Remove launch ${target}`,
    }),
    resource: (target) => `launch ${target}`,
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
    options: ["id", ...PLACE_OPTIONS],
    signature: `/** Move a definition or folder into a folder (null: top level), before a sibling or last. ${WRITES} */ move(options: { id: string } & LaunchPlacement): Promise<{ ok: true }>`,
    parse: (options) => ({ id: id(options), ...placement(options) }),
    authorize: ({ id: target }) => ({
      targets: [TARGET],
      summary: `Move launch entry ${target}`,
    }),
    resource: ({ id: target }) => `launch ${target}`,
    run: async ({ id: target, ...place }, env) =>
      await port(env).move(target, place),
  }),
];
