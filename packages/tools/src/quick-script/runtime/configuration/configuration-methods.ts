import { codedError } from "../errors.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkMethod } from "../sdk-types.js";

function port(env: Parameters<SdkMethod["prepare"]>[1]) {
  const agent = env.context.configurationAgent;
  if (!agent)
    throw codedError(
      "FORBIDDEN",
      "This run cannot reload configuration (no configuration port).",
    );
  return agent;
}

const parseScope = (options: Record<string, unknown>) => {
  const { scope } = options;
  if (scope !== "user" && scope !== "project")
    throw new Error('scope must be "user" or "project".');
  return scope;
};

/**
 * `configuration.*`: after the agent edits configuration files by hand, make Nerve re-read them.
 * Neither method writes a file or grants trust.
 */
export const configurationMethods: SdkMethod[] = [
  defineMethod({
    product: "configuration",
    path: "reload",
    // Re-reads local files and refreshes in-memory state; changes no file. Trust is untouched, and
    // the write that changed the file was already checked as a file write.
    risk: "read",
    bare: "scope",
    options: ["scope"],
    signature:
      '/** Re-read Nerve\'s configuration files of the scope ("project" is this conversation\'s project) after you edited them: agent.json, conversation defaults, agent profiles (new and removed files too), permission overlays, for "project" the launch definitions, and for "user" rule sets. Returns what is still wrong; empty means all files load. Never trusts anything: a project file listed with `trust: "untrusted"` stays ignored until the user approves it in Settings → This project → Trust. */ reload(scope: "user" | "project" | { scope: "user" | "project" }): Promise<ConfigurationResult>',
    parse: (options) => parseScope(options),
    authorize: (scope) => ({
      targets: [`configuration:scope/${scope}`],
      summary: `Reload ${scope} configuration`,
    }),
    resource: (scope) => `${scope} configuration`,
    run: async (scope, env) => await port(env).reload(scope),
  }),
  defineMethod({
    product: "configuration",
    path: "status",
    risk: "none",
    bare: "scope",
    options: ["scope"],
    signature:
      '/** Problems of the scope\'s configuration files as last loaded, same shape as `reload`. Call `reload` first after editing files. */ status(scope: "user" | "project" | { scope: "user" | "project" }): Promise<ConfigurationResult>',
    parse: (options) => parseScope(options),
    resource: (scope) => `${scope} configuration`,
    run: async (scope, env) => await port(env).status(scope),
  }),
];
