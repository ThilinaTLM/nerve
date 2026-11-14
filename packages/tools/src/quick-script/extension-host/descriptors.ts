import type {
  ExtensionMetadata,
  ExtensionSettingsDefinition,
} from "@nervekit/contracts/extensions";
import type { ExtensionManifest } from "../manifest-types.js";

/** What the settings machinery needs of an extension. */
export function extensionSettingsDefinition(
  extension: ExtensionManifest,
): ExtensionSettingsDefinition {
  return {
    id: extension.id,
    settingsVersion: extension.settingsVersion,
    enabledByDefault: extension.enabledByDefault,
    settings: extension.settings,
    ...(extension.migrations ? { migrations: extension.migrations } : {}),
  };
}

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
