import { assertUniqueAccountKinds } from "@nervekit/contracts/settings";
import {
  VIEW_SECTION_ID,
  type ExtensionDefinition,
  type ToolDefinition as ExtensionToolDefinition,
} from "@nervekit/extension-api";
import { resolveExtensionIcon } from "./extension-host/icon.js";
import { fromDefinition } from "./extension-host/from-definition.js";
import { createSdkNamespace } from "./runtime/discovery.js";
import { runtimeNamespaces } from "./runtime/runtime-namespaces.js";
import type { SdkMethod } from "./runtime/sdk-types.js";
import type {
  ExtensionManifest,
  RegisteredNamespace,
} from "./manifest-types.js";
import { readRuntimeDoc } from "./docs-source.js";
import type { ExtensionCodeAdapter } from "./extension-host/code-adapter.js";

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
  /** How the extensions' code is reached; absent: in the host process. A run's context can override it. */
  readonly extensionCodeAdapter?: ExtensionCodeAdapter;
};

/** What the host provides besides the definitions. */
export type QuickScriptRegistryOptions = {
  /**
   * Reads a file (a doc topic `DocTopic.file`, an `icon` SVG; relative to the extension's root)
   * of an extension. Extensions only declare paths; the host reads them.
   */
  readExtensionAsset?: (extensionId: string, file: string) => string;
  /** Where each extension's code runs (`routedExtensionCode`); absent: every extension runs in the host process. */
  extensionCodeAdapter?: ExtensionCodeAdapter;
};

/**
 * Builds the registry of the runtime's own capabilities plus `extensions`,
 * definitions built on `@nervekit/extension-api`.
 */
export function createQuickScriptRegistry(
  input: readonly ExtensionDefinition[],
  options: QuickScriptRegistryOptions = {},
): QuickScriptRegistry {
  const extensions = input.map((definition) =>
    fromDefinition(
      definition,
      resolveExtensionIcon(definition, options.readExtensionAsset),
    ),
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
          readDoc: (file) => {
            if (!options.readExtensionAsset)
              throw new Error(
                `${extension.id}: no docs are bundled (${file}).`,
              );
            return options.readExtensionAsset(extension.id, file);
          },
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
  for (const { definition } of tools) assertToolView(definition);
  return {
    extensions,
    tools,
    namespaces,
    methods: namespaces.flatMap((namespace) => namespace.methods),
    limits: Object.assign({}, ...extensions.map((e) => e.limits ?? {})),
    ...(options.extensionCodeAdapter
      ? { extensionCodeAdapter: options.extensionCodeAdapter }
      : {}),
  };
}

/** A tool's view names its own arguments, unique section ids, and streams only into text. */
function assertToolView(tool: ExtensionToolDefinition): void {
  const view = tool.view;
  if (!view) return;
  const fail = (message: string): never => {
    throw new Error(`Tool ${tool.name}: view ${message}.`);
  };
  if (view.sections.length === 0) fail("declares no sections");
  const parameters = Object.keys(tool.parameters.properties ?? {});
  for (const argument of [
    ...(view.header ? [view.header.argument] : []),
    ...(view.meta ?? []),
  ])
    if (!parameters.includes(argument))
      fail(`names unknown argument '${argument}'`);
  if ((view.meta?.length ?? 0) > 3) fail("lists more than 3 meta arguments");
  const ids = new Set<string>();
  for (const section of view.sections) {
    if (!VIEW_SECTION_ID.test(section.id))
      fail(`section id '${section.id}' is not a lower-case identifier`);
    if (ids.has(section.id)) fail(`repeats section '${section.id}'`);
    ids.add(section.id);
    if (section.live && section.type !== "text" && section.type !== "markdown")
      fail(`section '${section.id}' is live but not text or markdown`);
  }
}

function assertUnique(ids: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate ${what} '${id}'.`);
    seen.add(id);
  }
}

export function findNamespace(
  id: string,
  registry: QuickScriptRegistry,
): RegisteredNamespace | undefined {
  return registry.namespaces.find((namespace) => namespace.id === id);
}
