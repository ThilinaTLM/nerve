import type { AccountKind } from "@nervekit/contracts/extensions";
import type { ExtensionDefinition } from "@nervekit/extension-api";
import type { ExtensionCredentialCode } from "../../../domains/accounts/extension-credential-provider.js";
import type { QuickScriptRegistry } from "@nervekit/tools/quick-script";

/** The credential provider code of each installed definition that ships one (set when the catalog loads it). */
export const credentialCode = new WeakMap<
  ExtensionDefinition,
  ExtensionCredentialCode
>();

/**
 * Account kinds of the composed registries (keyed by project directory, "" for none). A kind a
 * project's own extension defines carries that project's directory key; the others (built-in,
 * user) are available everywhere. Kinds are unique across built-ins and user extensions; two
 * projects may each define the same name.
 */
export function accountDefinitions(
  composed: ReadonlyMap<string, { registry: QuickScriptRegistry }>,
): {
  kind: AccountKind;
  projectDir?: string;
  credentials?: ExtensionCredentialCode;
}[] {
  const global = new Map<
    string,
    { kind: AccountKind; credentials?: ExtensionCredentialCode }
  >();
  const perProject = new Map<
    string,
    {
      kind: AccountKind;
      projectDir: string;
      credentials?: ExtensionCredentialCode;
    }
  >();
  for (const [key, { registry }] of composed)
    for (const extension of registry.extensions)
      for (const kind of extension.accounts ?? []) {
        const credentials =
          kind.provider === "extension" && extension.definition
            ? credentialCode.get(extension.definition)
            : undefined;
        const entry = { kind, ...(credentials ? { credentials } : {}) };
        if (extension.source === "project")
          perProject.set(`${key}\u0000${kind.kind}`, {
            ...entry,
            projectDir: key,
          });
        else if (!global.has(kind.kind)) global.set(kind.kind, entry);
      }
  return [...global.values(), ...perProject.values()];
}
