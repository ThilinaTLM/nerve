import { codedError } from "../errors.js";
import { defineMethod } from "../sdk-args.js";
import type { SdkMethod } from "../sdk-types.js";

function port(env: Parameters<SdkMethod["prepare"]>[1]) {
  const agent = env.context.extensionAgent;
  if (!agent)
    throw codedError(
      "FORBIDDEN",
      "This run cannot manage extensions (no installed-extension catalog).",
    );
  return agent;
}

const parseId = (options: Record<string, unknown>) => {
  const { id } = options;
  if (typeof id !== "string" || !id.trim())
    throw new Error("id must be a non-empty string.");
  return id.trim();
};

/**
 * `extensions.*`: build loop for the agent. Neither method touches consent: only the user's
 * Settings page allows an extension.
 */
export const extensionsMethods: SdkMethod[] = [
  defineMethod({
    product: "extensions",
    path: "reload",
    // Re-reads local files and refreshes in-memory state; changes no file. Consent is untouched,
    // and the write that changed the folder was already checked as a file write.
    risk: "read",
    bare: "id",
    options: ["id"],
    signature:
      "/** Re-read an installed extension's folder (its `dist/`) in this project and return its status; use it after `nerve-ext check`. Never allows the extension: a pending one stays pending until the user allows it in Settings → Extensions. */ reload(id: string): Promise<ExtensionStatus>",
    parse: (options) => parseId(options),
    authorize: (id) => ({
      targets: [`extensions:extension/${id}`],
      summary: `Reload extension ${id}`,
    }),
    resource: (id) => `extension ${id}`,
    run: async (id, env) => await port(env).reload(id),
  }),
  defineMethod({
    product: "extensions",
    path: "status",
    risk: "none",
    bare: "id",
    options: ["id"],
    signature:
      "/** State, source, folder, consent (pending or granted), diagnostics and recent backend errors of an extension in this project. Reads the last load; call `reload` first to re-read the folder. */ status(id: string): Promise<ExtensionStatus>",
    parse: (options) => parseId(options),
    resource: (id) => `extension ${id}`,
    run: async (id, env) => await port(env).status(id),
  }),
];
