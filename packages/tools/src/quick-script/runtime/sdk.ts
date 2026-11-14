import { quickScriptRegistry, type QuickScriptRegistry } from "../registry.js";
import { ExtensionRuntime } from "../extension-host/runtime.js";
import { librariesPrelude } from "./libraries.js";
import { RUNTIME_HEAD, runtimeTail } from "./runtime-prelude.js";
import type {
  QuickScriptContext,
  SdkEnvironment,
  SdkMethod,
} from "./sdk-types.js";

/**
 * The SDK in one place. Every method declares its signature, what it is
 * authorized as (an operation with targets), and its implementation. The prelude injected into the
 * sandbox is generated from the method tables the registry collects; the
 * Markdown docs are checked against them by the extensions package.
 */

export type { SdkEnvironment, SdkMethod } from "./sdk-types.js";

type Derived = {
  methodByName: Map<string, SdkMethod>;
  prelude: string;
};

const derived = new WeakMap<QuickScriptRegistry, Derived>();

function derive(registry: QuickScriptRegistry): Derived {
  let value = derived.get(registry);
  if (!value) {
    value = {
      methodByName: new Map(
        registry.methods.map((method) => [
          `${method.product}.${method.path}`,
          method,
        ]),
      ),
      prelude: buildPrelude(registry),
    };
    derived.set(registry, value);
  }
  return value;
}

export function findSdkMethod(
  name: string,
  registry: QuickScriptRegistry = quickScriptRegistry(),
): SdkMethod | undefined {
  return derive(registry).methodByName.get(name);
}

export function sdkMethodNames(
  registry: QuickScriptRegistry = quickScriptRegistry(),
): string[] {
  return [...derive(registry).methodByName.keys()];
}

export function createSdkEnvironment(
  context: QuickScriptContext,
): SdkEnvironment {
  const registry = context.registry ?? quickScriptRegistry();
  const environment: SdkEnvironment = {
    context,
    registry,
    // Assigned right below: the runtime reads the environment's report and context.
    extensions: undefined as unknown as SdkEnvironment["extensions"],
    discovery: { used: 0 },
    report: {
      artifacts: new Map(),
      created: [],
      updated: [],
      deleted: [],
      raw: [],
      notes: [],
    },
  };
  environment.extensions = new ExtensionRuntime(environment);
  return environment;
}

/** `jira.issues.get = (...args) => call("jira.issues.get", args)`, nested by group. */
function productPrelude(
  methods: readonly SdkMethod[],
  product: string,
): string {
  const groups = new Map<string, string[]>();
  for (const method of methods.filter((m) => m.product === product)) {
    const parts = method.path.split(".");
    const name = parts.pop()!;
    const group = parts.join(".");
    const entries = groups.get(group) ?? [];
    entries.push(
      `${name}: (...args) => call("${product}.${method.path}", args),`,
    );
    groups.set(group, entries);
  }
  const body = [...groups]
    .map(([group, entries]) =>
      group
        ? `    ${group}: {\n      ${entries.join("\n      ")}\n    },`
        : `    ${entries.join("\n    ")}`,
    )
    .join("\n");
  return `  globalThis.${product} = {\n${body}\n  };`;
}

/** Trusted prelude: SDK objects forwarding to `host.call`, plus the extensions' pure-JS helpers (`storage.*`). */
function buildPrelude(registry: QuickScriptRegistry): string {
  const methods = registry.methods;
  /** Namespaces with host methods get a global object; `image` is a function and gets none (the prelude wraps it). */
  const withMethods = registry.namespaces.filter(
    (namespace) => namespace.methods.length > 0,
  );
  const guarded = withMethods
    .filter((namespace) => !namespace.callable)
    .map((namespace) => namespace.id);
  return [
    `(() => {\n${RUNTIME_HEAD}`,
    ...withMethods.map((namespace) => productPrelude(methods, namespace.id)),
    `${runtimeTail(guarded)}})();`,
    ...registry.extensions.flatMap((extension) =>
      extension.prelude ? [extension.prelude] : [],
    ),
  ].join("\n");
}

/** Everything evaluated before the module: the SDK, plus lazy libraries the script mentions. */
export function preludesFor(
  code: string,
  registry: QuickScriptRegistry = quickScriptRegistry(),
): Array<{ name: string; source: string }> {
  const libraries = librariesPrelude(code);
  return [
    { name: "nerve:atlassian-sdk", source: derive(registry).prelude },
    ...(libraries ? [{ name: "nerve:libraries", source: libraries }] : []),
  ];
}

/**
 * Wraps the script so a top-level `return value` works while top-level `await`
 * keeps working: the body becomes an async function whose result is printed.
 * The wrapper opens on the script's first line, so reported line numbers match.
 */
export function wrapScript(code: string): string {
  return `__nerveReturn(await (async () => {${code}\n})());`;
}
