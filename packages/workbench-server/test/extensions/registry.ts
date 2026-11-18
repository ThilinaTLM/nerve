import {
  readBuiltinExtensionAsset,
  readBuiltinExtensionBundle,
} from "@nervekit/extensions/assets";
import {
  builtinExtensions,
  sandboxedBuiltinExtensions,
} from "@nervekit/extensions";
import {
  createQuickScriptRegistry,
  routedExtensionCode,
  sandboxExtensionCode,
  executeQuickScript as runQuickScript,
} from "@nervekit/tools/quick-script";

/** The registry the host composes from the built-in list; tests that exercise the runtime with the built-ins use it. */
export const registry = createQuickScriptRegistry(builtinExtensions, {
  readExtensionAsset: readBuiltinExtensionAsset,
  // As the host composes it: the sandboxed built-ins run in the sandbox.
  extensionCodeAdapter: routedExtensionCode({
    sandboxed: (definition) => sandboxedBuiltinExtensions.has(definition.id),
    sandbox: sandboxExtensionCode({
      bundle: (definition) => readBuiltinExtensionBundle(definition.id),
    }),
  }),
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
