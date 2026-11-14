import type { QuickScriptRegistry } from "../registry.js";

/**
 * The sandbox globals that reach the host: `files`, `image` and every extension
 * namespace with host methods (derived, so a new extension is scanned from day one).
 */
const globalsCache = new WeakMap<QuickScriptRegistry, ReadonlySet<string>>();
export function sdkGlobals(registry: QuickScriptRegistry): ReadonlySet<string> {
  let globals = globalsCache.get(registry);
  if (!globals) {
    globals = new Set([
      "files",
      "image",
      ...registry.namespaces
        .filter(
          (namespace) =>
            namespace.source === "extension" && namespace.methods.length > 0,
        )
        .map((namespace) => namespace.id),
    ]);
    globalsCache.set(registry, globals);
  }
  return globals;
}
