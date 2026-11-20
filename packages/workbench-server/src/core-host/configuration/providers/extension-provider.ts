import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import type { ExtensionCatalogEntry } from "@nervekit/contracts/extensions";
import type { ExtensionCatalog } from "../../extensions/extension-catalog/extension-catalog.js";
import {
  type ConfigurationResourceProvider,
  type ResourceContext,
} from "../resource-registry.js";

const CONSENT = { kind: "consent", where: "Settings → Extensions" } as const;

const STATES: Record<
  ExtensionCatalogEntry["state"],
  ConfigurationResource["state"]
> = {
  enabled: "active",
  pending_consent: "needs_approval",
  incompatible: "incompatible",
  invalid: "invalid",
  shadowed: "shadowed",
};

/**
 * Extensions as a summary; `extensions.status(id)` has the detail (consent, switch, recent
 * errors). Checking reads the catalog as loaded; reloading re-reads every folder of the scope.
 */
export function extensionProvider(options: {
  catalog: Pick<ExtensionCatalog, "entries" | "reload">;
}): ConfigurationResourceProvider {
  async function all(
    context: ResourceContext,
  ): Promise<ConfigurationResource[]> {
    const entries = await options.catalog.entries(context.projectDirectory);
    return entries
      .filter(
        (entry) =>
          entry.source === context.scope ||
          (context.scope === "user" && entry.source === "builtin"),
      )
      .map(
        (entry): ConfigurationResource => ({
          kind: "extension",
          id: entry.id,
          scope: entry.source,
          ...(entry.path ? { path: entry.path } : {}),
          state: STATES[entry.state],
          ...(entry.state === "pending_consent" ? { approval: CONSENT } : {}),
          ...(entry.shadowedBy ? { shadowedBy: entry.shadowedBy } : {}),
          diagnostics: entry.diagnostics,
        }),
      );
  }
  const problems = async (context: ResourceContext) =>
    (await all(context)).filter((entry) => entry.diagnostics.length > 0);
  return {
    kinds: ["extension"],
    list: all,
    check: problems,
    async reload(context) {
      await options.catalog.reload();
      return await problems(context);
    },
  };
}
