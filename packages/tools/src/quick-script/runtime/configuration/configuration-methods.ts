import { codedError } from "../errors.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkMethod } from "../sdk-types.js";

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
  'agent.json, conversation defaults, agent profiles, the permission overlay, for "project" the launch definitions, and for "user" every rule set';

/**
 * `configuration.*`: validate the configuration files the agent edited by hand and make Nerve
 * re-read them. Neither method writes a file or grants trust.
 */
export const configurationMethods: SdkMethod[] = [
  defineMethod({
    product: "configuration",
    path: "check",
    risk: "none",
    bare: "scope",
    options: ["scope"],
    signature: `/** Validate the scope's configuration files as they are on disk ("project" is this conversation's project): ${COVERS}. Changes nothing, so call it after every edit and before \`reload\`. Returns the resources that have a diagnostic; empty means every file is valid. */ check(scope: ${SCOPE}): Promise<ConfigurationResult>`,
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
