import { configurationResourceSchema } from "@nervekit/contracts/configuration";
import { codedError } from "../errors.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkMethod } from "../sdk-types.js";
import type { ConfigurationListFilter } from "./configuration-port.js";

function port(env: Parameters<SdkMethod["prepare"]>[1]) {
  const agent = env.context.configurationAgent;
  if (!agent)
    throw codedError(
      "FORBIDDEN",
      "This run cannot check or reload configuration (no configuration port).",
    );
  return agent;
}

const parseScope = (options: Record<string, unknown>) => {
  const { scope } = options;
  if (scope !== "user" && scope !== "project")
    throw new Error('scope must be "user" or "project".');
  return scope;
};

const SCOPE = '"user" | "project" | { scope: "user" | "project" }';
const COVERS =
  'agent.json, conversation defaults, agent profiles, the permission overlay, skills, prompt suggestions, extensions, for "project" the launch definitions, and for "user" every rule set';

/**
 * `configuration.*`: validate the configuration files the agent edited by hand and make Nerve
 * re-read them. Neither method writes a file or grants trust.
 */
export const configurationMethods: SdkMethod[] = [
  defineMethod({
    product: "configuration",
    path: "describe",
    risk: "none",
    options: [],
    signature:
      "/** This conversation's context: project directory, Nerve home, the selected rule set and what selected it, the model, the applied profile with the settings it locks, and the models a setting may name. Call it before changing permissions or profiles. */ describe(): Promise<ConfigurationDescription>",
    parse: () => undefined,
    resource: () => "configuration",
    run: async (_input, env) => await port(env).describe(),
  }),
  defineMethod({
    product: "configuration",
    path: "list",
    risk: "none",
    options: ["kind", "scope", "state"],
    signature:
      '/** Everything configured, after precedence: profiles, rule sets, overlays, launch catalog, skills, prompt suggestions, extensions; built-in, user and this project. Filter with any of kind, scope, state, e.g. `{ kind: "rule-set" }` for the ids a profile may select, `{ state: "needs_approval" }` for what waits for the user, `{ kind: "extension", state: "incompatible" }` after an update. Reads loaded state; `check` reads the disk. */ list(filter?: { kind?: ConfigurationResource["kind"]; scope?: ConfigurationResource["scope"]; state?: ConfigurationResource["state"] }): Promise<ConfigurationResult>',
    parse: (options): ConfigurationListFilter => {
      // A misspelt value would match nothing and read as "nothing configured".
      for (const key of ["kind", "scope", "state"] as const) {
        const allowed = configurationResourceSchema.shape[key].options;
        if (
          options[key] !== undefined &&
          !(allowed as readonly unknown[]).includes(options[key])
        )
          throw new Error(
            `${key} must be one of ${allowed.map((value) => `"${value}"`).join(", ")}.`,
          );
      }
      return options;
    },
    resource: () => "configuration",
    run: async (filter, env) => await port(env).list(filter),
  }),
  defineMethod({
    product: "configuration",
    path: "tools.list",
    risk: "none",
    options: [],
    signature:
      "/** Every tool as permission rules match it: exact name, kind, groups, base risk, primary arguments and the extension that contributes it. Take names for `toolNames` and `toolGroups` from here, never from memory: they are case-sensitive. */ list(): Promise<{ tools: ConfigurationTool[] }>",
    parse: () => undefined,
    resource: () => "configuration",
    run: async (_input, env) => await port(env).tools(),
  }),
  defineMethod({
    product: "configuration",
    path: "explain",
    risk: "none",
    options: ["tool", "args"],
    signature:
      '/** What the active policy decides for one call in this conversation, and which rule decides it. Never runs the call. Use it to answer "why was that prompted?" and to verify a rule after `reload`, e.g. `{ tool: "bash", args: { command: "pnpm test" } }`. For a script, pass `{ tool: "quick_script", args: { code } }`. */ explain(call: { tool: string; args?: Record<string, unknown> }): Promise<ConfigurationExplanation>',
    parse: (options) => {
      const { tool, args = {} } = options;
      if (typeof tool !== "string" || tool.length === 0)
        throw new Error(
          "tool must be a tool name; see configuration.tools.list().",
        );
      if (typeof args !== "object" || args === null || Array.isArray(args))
        throw new Error("args must be an object.");
      return { tool, args: args as Record<string, unknown> };
    },
    resource: (call) => call.tool,
    run: async (call, env) => await port(env).explain(call),
  }),
  defineMethod({
    product: "configuration",
    path: "check",
    risk: "none",
    bare: "scope",
    options: ["scope"],
    signature: `/** Validate the scope's configuration files as they are on disk ("project" is this conversation's project): ${COVERS}. Changes nothing, so call it after every edit and before \`reload\`. Returns only the resources that have a diagnostic; empty means every file is valid. */ check(scope: ${SCOPE}): Promise<ConfigurationResult>`,
    parse: (options) => parseScope(options),
    resource: (scope) => `${scope} configuration`,
    run: async (scope, env) => await port(env).check(scope),
  }),
  defineMethod({
    product: "configuration",
    path: "reload",
    // Re-reads local files and refreshes in-memory state; changes no file. Trust is untouched, and
    // the write that changed the file was already checked as a file write.
    risk: "read",
    bare: "scope",
    options: ["scope"],
    signature: `/** Make Nerve re-read the scope's configuration files after you edited them: ${COVERS}. New and removed files are picked up. A file that is invalid on disk does not replace the version that was loaded: it comes back with \`previousVersionActive: true\` and the old version stays in use until you fix the file and reload again. Returns the resources that have a diagnostic; empty means every file is valid and active. Never approves anything: a project file in state "needs_approval" stays ignored until the user approves it where \`approval.where\` says. */ reload(scope: ${SCOPE}): Promise<ConfigurationResult>`,
    parse: (options) => parseScope(options),
    authorize: (scope) => ({
      targets: [`configuration:scope/${scope}`],
      summary: `Reload ${scope} configuration`,
    }),
    resource: (scope) => `${scope} configuration`,
    run: async (scope, env) => await port(env).reload(scope),
  }),
];
