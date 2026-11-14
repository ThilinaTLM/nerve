import { readBuiltinExtensionDoc } from "@nervekit/extensions/docs";
import { builtinExtensions } from "@nervekit/extensions";
import {
  createQuickScriptRegistry,
  executeQuickScript as runQuickScript,
} from "@nervekit/tools/quick-script";

/** The registry the host composes from the built-in list; tests that exercise the runtime with the built-ins use it. */
export const registry = createQuickScriptRegistry(builtinExtensions, {
  readExtensionDoc: readBuiltinExtensionDoc,
});

export const registeredNamespaces = registry.namespaces;
export const registeredMethods = registry.methods;

type Context = Omit<Parameters<typeof runQuickScript>[1], "registry">;

/** `executeQuickScript` serving the built-ins' registry. */
export function executeQuickScript(
  args: { code: string; timeout?: number },
  context: Context,
) {
  return runQuickScript(args, { ...context, registry });
}
