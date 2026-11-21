import type { ExtensionHostPorts } from "@nervekit/tools/extension-host";
import type { AccountsReader } from "./accounts.service.js";

/**
 * A reader as the extension host sees accounts: plain `AccountInfo` without a project id, the
 * credential reachable only through `apply`. `userLevelOnly` decides, per selecting setting,
 * whether the selection may name user-level accounts only.
 */
export function accountPorts(
  accounts: AccountsReader,
  userLevelOnly: (
    selection: { extensionId: string; field: string } | undefined,
  ) => boolean = () => false,
): ExtensionHostPorts["accounts"] {
  return {
    get: async (kind, id, selection) => {
      const found = await accounts.get(kind, id, {
        userLevelOnly: userLevelOnly(selection),
      });
      return found
        ? {
            id: found.id,
            name: found.name,
            kind: found.kind,
            fields: found.fields,
            level: found.level,
          }
        : undefined;
    },
    state: (kind, id) => accounts.state(kind, id),
    apply: (kind, id, request) => accounts.apply(kind, id, request),
    touch: (kind, id) => accounts.touch(kind, id),
  };
}
