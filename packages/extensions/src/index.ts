import type { ExtensionDefinition } from "@nervekit/extension-api";
import type {
  ExtensionMetadata,
  ExtensionSettingsDefinition,
} from "@nervekit/contracts/extensions";
import { fromDefinition } from "@nervekit/tools/quick-script";
import type { ExtensionManifest } from "@nervekit/tools/quick-script/manifest-types";
import { atlassianExtension } from "./atlassian/manifest.js";
import { diagramExtension } from "./diagram/manifest.js";
import { imagegenExtension } from "./imagegen/manifest.js";
import { webExtension } from "./web/manifest.js";

const definitions: readonly (ExtensionManifest | ExtensionDefinition)[] = [
  atlassianExtension,
  webExtension,
  imagegenExtension,
  diagramExtension,
];

/** The built-in extensions, in display order, as the registry sees them. */
export const builtinExtensions: readonly ExtensionManifest[] = definitions.map(
  (extension) =>
    "apiVersion" in extension ? fromDefinition(extension) : extension,
);

/** What the settings machinery needs of every registered extension. */
export const extensionSettingsDefinitions: readonly ExtensionSettingsDefinition[] =
  builtinExtensions.map((extension) => ({
    id: extension.id,
    settingsVersion: extension.settingsVersion,
    enabledByDefault: extension.enabledByDefault,
    settings: extension.settings,
    ...(extension.migrations ? { migrations: extension.migrations } : {}),
  }));

/** Serializable description of an extension, for the app. */
export function extensionMetadata(
  extension: ExtensionManifest,
): ExtensionMetadata {
  return {
    id: extension.id,
    name: extension.name,
    description: extension.description,
    icon: extension.icon,
    source: extension.source,
    settingsVersion: extension.settingsVersion,
    enabledByDefault: extension.enabledByDefault,
    permissions: {
      ...(extension.permissions?.network
        ? { network: [...extension.permissions.network] }
        : {}),
      ...(extension.permissions?.capabilities
        ? { capabilities: [...extension.permissions.capabilities] }
        : {}),
    },
    contributes: {
      namespaces: (extension.contributes.sdk ?? []).map((namespace) => ({
        id: namespace.id,
        ...(namespace.enabledBy ? { enabledBy: namespace.enabledBy } : {}),
        ...(namespace.requires?.account
          ? { requiresAccount: namespace.requires.account }
          : {}),
        ...(namespace.helper ? { helper: true } : {}),
        summary: namespace.summary,
      })),
      tools: extension.contributes.tools ?? [],
      skills: extension.contributes.skills ?? [],
    },
  };
}
