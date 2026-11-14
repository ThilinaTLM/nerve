import type { ExtensionResolution } from "@nervekit/contracts/extensions";
import type { ExtensionHostPorts } from "@nervekit/tools/quick-script";
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
