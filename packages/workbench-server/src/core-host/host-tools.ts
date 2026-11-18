import { registerToolDefinitions } from "@nervekit/tools/catalog";
import {
  builtinExtensions,
  sandboxedBuiltinExtensions,
} from "@nervekit/extensions";
import {
  readBuiltinExtensionAsset,
  readBuiltinExtensionBundle,
} from "@nervekit/extensions/assets";
import { version as nerveVersion } from "../app/version.js";
import {
  ExtensionCatalog,
  type ExtensionCatalogOptions,
} from "./extension-catalog/extension-catalog.js";
import {
  ExtensionConsentRepository,
  type ExtensionConsentSources,
} from "./extension-catalog/extension-consent.js";
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

/**
 * The catalog of the extensions a home serves: the built-ins, the home's user extensions and,
 * per project, the project's own. The registries it composes are what conversations read;
 * `hostRegistry` is its built-ins-only base.
 */
export function createHostExtensionCatalog({
  consent,
  ...options
}: Pick<ExtensionCatalogOptions, "home"> &
  Partial<
    Pick<ExtensionCatalogOptions, "trustGate" | "warn" | "nerveVersion">
  > & {
    /** Where consent is stored; without it (and a `trustGate`) no installed extension runs. */
    consent?: ExtensionConsentSources;
  }): ExtensionCatalog {
  return new ExtensionCatalog({
    ...options,
    nerveVersion: options.nerveVersion ?? nerveVersion,
    // Consent lives in the core's `trusted_resource` table.
    ...(options.trustGate || consent
      ? {
          trustGate:
            options.trustGate ?? new ExtensionConsentRepository(consent!),
        }
      : {}),
    builtins: {
      definitions: builtinExtensions,
      readAsset: readBuiltinExtensionAsset,
      sandboxed: sandboxedBuiltinExtensions,
      readBundle: readBuiltinExtensionBundle,
    },
  });
}

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
