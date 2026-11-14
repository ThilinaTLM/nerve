import type { ExtensionResolution } from "@nervekit/contracts/extensions";
import type {
  ExtensionHostPorts,
  QuickScriptRegistry,
} from "@nervekit/tools/quick-script";
import type { AccountsReader } from "../domains/accounts/accounts.service.js";
import { fieldValue } from "@nervekit/contracts/extensions";
import type { ExtensionState } from "@nervekit/tools/quick-script";

/** What the resolved settings say about each extension: its switch and field values. */
export function extensionStates(
  resolution: ExtensionResolution,
): (id: string) => ExtensionState | undefined {
  return (id) => {
    const resolved = resolution.extensions[id];
    if (!resolved) return undefined;
    return {
      enabled: resolved.enabled.value === true,
      settings: Object.fromEntries(
        Object.keys(resolved.fields).map((key) => [
          key,
          fieldValue(resolved, key),
        ]),
      ),
    };
  };
}

/**
 * How the extension runtime reaches this host: the resolved settings of the
 * conversation, the accounts store (the credential is only handed to the
 * runtime's `ctx.http`), and the image generation backend.
 */
export function createExtensionPorts(input: {
  resolution: ExtensionResolution;
  accounts: AccountsReader;
  generateImage?: ExtensionHostPorts["generateImage"];
  warn?: (extensionId: string, message: string, data?: unknown) => void;
}): ExtensionHostPorts {
  const states = extensionStates(input.resolution);
  return {
    settings: (id) => states(id)?.settings ?? {},
    accounts: {
      get: async (kind, id) => await input.accounts.get(kind, id),
      secret: async (kind, id) => await input.accounts.secret(kind, id),
    },
    ...(input.generateImage ? { generateImage: input.generateImage } : {}),
    log: (level, extensionId, message, data) => {
      if (level === "warn") input.warn?.(extensionId, message, data);
    },
  };
}

/**
 * What an approval of an extension call is bound to besides the settings: for
 * every enabled extension, the account each `account` setting selects, with its
 * non-secret fields. Switching the account, or its site, ends the approval; the
 * credential never enters it.
 */
export async function selectedAccountsTarget(
  registry: QuickScriptRegistry,
  resolution: ExtensionResolution,
  accounts: AccountsReader,
): Promise<Record<string, Record<string, unknown>>> {
  const states = extensionStates(resolution);
  const target: Record<string, Record<string, unknown>> = {};
  for (const extension of registry.extensions) {
    const state = states(extension.id);
    if (!state?.enabled) continue;
    const selected: Record<string, unknown> = {};
    for (const [field, declared] of Object.entries(extension.settings.fields)) {
      if (declared.type !== "account") continue;
      const id = state.settings[field];
      if (typeof id !== "string" || !id) continue;
      const account = await accounts.get(declared.kind, id);
      selected[field] = account
        ? {
            id: account.id,
            kind: account.kind,
            name: account.name,
            fields: account.fields,
          }
        : { id, missing: true };
    }
    if (Object.keys(selected).length > 0) target[extension.id] = selected;
  }
  return target;
}
