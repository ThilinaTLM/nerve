import { assertUniqueAccountKinds } from "@nervekit/contracts/settings";
import type {
  ExtensionDefinition,
  ToolDefinition as ExtensionToolDefinition,
} from "@nervekit/extension-api";
import {
  fromDefinition,
  isExtensionDefinition,
} from "./extension-host/from-definition.js";
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
  /** Direct tools the extensions contribute, with their extension. */
  readonly tools: readonly {
    readonly definition: ExtensionToolDefinition;
    readonly extension: ExtensionManifest;
  }[];
  readonly namespaces: readonly RegisteredNamespace[];
  readonly methods: readonly SdkMethod[];
  /** Limits the extensions declare, by `{{limit:<name>}}` name. */
  readonly limits: Readonly<Record<string, number>>;
};

/**
 * Builds the registry of the runtime's own capabilities plus `extensions`:
 * manifests (LEGACY shape of the current built-ins) or definitions built on
 * `@nervekit/extension-api`.
 */
export function createQuickScriptRegistry(
  input: readonly (ExtensionManifest | ExtensionDefinition)[],
): QuickScriptRegistry {
  const extensions = input.map((extension) =>
    isExtensionDefinition(extension) ? fromDefinition(extension) : extension,
  );
  assertUnique(
    extensions.map((extension) => extension.id),
    "extension",
  );
  assertUniqueAccountKinds(extensions);
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
  const tools = extensions.flatMap((extension) =>
    (extension.tools ?? []).map((definition) => ({ definition, extension })),
  );
  assertUnique(
    tools.map((tool) => tool.definition.name),
    "tool",
  );
  return {
    extensions,
    tools,
    namespaces,
    methods: namespaces.flatMap((namespace) => namespace.methods),
    limits: Object.assign({}, ...extensions.map((e) => e.limits ?? {})),
  };
}

function assertUnique(ids: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate ${what} '${id}'.`);
    seen.add(id);
  }
}

// LEGACY until extension-platform S2: the default registry. The host composes
// its own registry and passes it explicitly (`createQuickScriptTool`,
// `quickScriptDescription`, the authorizer, `context.registry`); this holder
// only serves callers that do not (the built-ins' tests and helpers).
let active: QuickScriptRegistry | undefined;

/** Sets the default registry (LEGACY, see above). */
export function installQuickScriptExtensions(
  extensions: readonly (ExtensionManifest | ExtensionDefinition)[],
): QuickScriptRegistry {
  active = createQuickScriptRegistry(extensions);
  return active;
}

/** The default registry (LEGACY, see above); the runtime's own capabilities only until one is installed. */
export function quickScriptRegistry(): QuickScriptRegistry {
  return (active ??= createQuickScriptRegistry([]));
}

export function findNamespace(
  id: string,
  registry: QuickScriptRegistry = quickScriptRegistry(),
): RegisteredNamespace | undefined {
  return registry.namespaces.find((namespace) => namespace.id === id);
}
