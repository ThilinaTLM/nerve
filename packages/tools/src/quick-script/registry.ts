import { createSdkNamespace } from "./runtime/discovery.js";
import { runtimeNamespaces } from "./runtime/runtime-namespaces.js";
import type { SdkMethod } from "./runtime/sdk-types.js";
import type {
  ExtensionManifest,
  RegisteredNamespace,
} from "./manifest-types.js";
import { readRuntimeDoc } from "./docs-source.js";

/**
 * Every `quick_script` namespace: the built-in capabilities, `sdk`, then the extensions'.
 * Description, prelude, guarded globals, discovery and the host's availability
 * all read it, so adding a namespace means adding it to a manifest.
 */
export type QuickScriptRegistry = {
  readonly extensions: readonly ExtensionManifest[];
  readonly namespaces: readonly RegisteredNamespace[];
  readonly methods: readonly SdkMethod[];
  /** Limits the extensions declare, by `{{limit:<name>}}` name. */
  readonly limits: Readonly<Record<string, number>>;
};

/** Builds the registry of the runtime's own capabilities plus `extensions`. */
export function createQuickScriptRegistry(
  extensions: readonly ExtensionManifest[],
): QuickScriptRegistry {
  const namespaces: RegisteredNamespace[] = [
    ...runtimeNamespaces.map(
      (namespace): RegisteredNamespace => ({
        ...namespace,
        source: "builtin",
        owner: "runtime",
        readDoc: readRuntimeDoc,
      }),
    ),
    {
      ...createSdkNamespace(() => namespaces),
      source: "builtin",
      owner: "runtime",
      readDoc: readRuntimeDoc,
    },
    ...extensions.flatMap((extension) =>
      (extension.contributes.sdk ?? []).map(
        (namespace): RegisteredNamespace => ({
          ...namespace,
          source: "extension",
          extension: extension.name,
          owner: extension.id,
          readDoc: extension.readDoc,
        }),
      ),
    ),
  ];
  return {
    extensions,
    namespaces,
    methods: namespaces.flatMap((namespace) => namespace.methods),
    limits: Object.assign({}, ...extensions.map((e) => e.limits ?? {})),
  };
}

let active: QuickScriptRegistry | undefined;

/**
 * The host calls this once at composition with the extensions it ships
 * (`builtinExtensions` of `@nervekit/extensions`); the runtime itself never imports them.
 * Until then the registry holds the runtime's own capabilities only.
 */
export function installQuickScriptExtensions(
  extensions: readonly ExtensionManifest[],
): QuickScriptRegistry {
  active = createQuickScriptRegistry(extensions);
  return active;
}

export function quickScriptRegistry(): QuickScriptRegistry {
  return (active ??= createQuickScriptRegistry([]));
}

export function findNamespace(id: string): RegisteredNamespace | undefined {
  return quickScriptRegistry().namespaces.find(
    (namespace) => namespace.id === id,
  );
}
