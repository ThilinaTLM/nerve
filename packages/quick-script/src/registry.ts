import type {
  ExtensionMetadata,
  ExtensionSettingsDefinition,
} from "@nervekit/contracts/extensions";
import { createSdkNamespace } from "./runtime/discovery.js";
import { runtimeNamespaces } from "./runtime/runtime-namespaces.js";
import type { SdkMethod } from "./runtime/sdk-types.js";
import { atlassianExtension } from "./extensions/atlassian/manifest.js";
import { diagramExtension } from "./extensions/diagram/manifest.js";
import type {
  ExtensionManifest,
  RegisteredNamespace,
} from "./manifest-types.js";
import { webExtension } from "./extensions/web/manifest.js";

/** The built-in extensions, in display order. */
export const builtinExtensions: readonly ExtensionManifest[] = [
  atlassianExtension,
  webExtension,
  diagramExtension,
];

/**
 * Every `quick_script` namespace: the runtime's, `sdk`, then the extensions'.
 * Description, prelude, guarded globals, discovery and the host's availability
 * all read this list, so adding a namespace means adding it to a manifest.
 */
export const registeredNamespaces: readonly RegisteredNamespace[] = [
  ...runtimeNamespaces.map(
    (namespace): RegisteredNamespace => ({
      ...namespace,
      source: "runtime",
      owner: "runtime",
    }),
  ),
  {
    ...createSdkNamespace(() => registeredNamespaces),
    source: "runtime",
    owner: "runtime",
  },
  ...builtinExtensions.flatMap((extension) =>
    (extension.contributes.sdk ?? []).map(
      (namespace): RegisteredNamespace => ({
        ...namespace,
        source: extension.source,
        owner: extension.id,
      }),
    ),
  ),
];

export const registeredMethods: readonly SdkMethod[] =
  registeredNamespaces.flatMap((namespace) => namespace.methods);

export function findNamespace(id: string): RegisteredNamespace | undefined {
  return registeredNamespaces.find((namespace) => namespace.id === id);
}

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
    contributes: {
      namespaces: (extension.contributes.sdk ?? []).map((namespace) => ({
        id: namespace.id,
        ...(namespace.enabledBy ? { enabledBy: namespace.enabledBy } : {}),
        summary: namespace.summary,
      })),
      tools: extension.contributes.tools ?? [],
      skills: extension.contributes.skills ?? [],
    },
  };
}
