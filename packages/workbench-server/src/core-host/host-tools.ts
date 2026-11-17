import { registerToolDefinitions } from "@nervekit/tools/catalog";
import {
  builtinExtensions,
  sandboxedBuiltinExtensions,
} from "@nervekit/extensions";
import {
  readBuiltinExtensionAsset,
  readBuiltinExtensionBundle,
} from "@nervekit/extensions/assets";
import {
  createQuickScriptRegistry,
  routedExtensionCode,
  sandboxExtensionCode,
  extensionSettingsDefinition,
  quickScriptHostTools,
} from "@nervekit/tools/quick-script";

/**
 * The extensions this host serves, composed once from the built-in list
 * (`@nervekit/tools` cannot import them). The registry is passed explicitly to
 * everything that needs it: the tools, the description, the authorizer and the
 * availability.
 */
export const hostRegistry = createQuickScriptRegistry(builtinExtensions, {
  readExtensionAsset: readBuiltinExtensionAsset,
  extensionCodeAdapter: routedExtensionCode({
    sandboxed: (definition) => sandboxedBuiltinExtensions.has(definition.id),
    sandbox: sandboxExtensionCode({
      bundle: (definition) => readBuiltinExtensionBundle(definition.id),
    }),
  }),
});

/** What the settings machinery needs of every registered extension. */
export const extensionSettingsDefinitions = hostRegistry.extensions.map(
  extensionSettingsDefinition,
);

/**
 * Adds the tool definitions that other packages own to the tools catalog:
 * `quick_script` and the direct tools the extensions contribute. Safe to call
 * again; every composition root that reads the catalog calls it first.
 */
export function registerHostTools(): void {
  registerToolDefinitions(quickScriptHostTools(hostRegistry));
}
