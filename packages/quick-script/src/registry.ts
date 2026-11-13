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
