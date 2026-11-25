import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import type { ExtensionCatalogEntry } from "@nervekit/contracts/extensions";
import { join } from "node:path";
import { version as nerveVersion } from "../../../app/version.js";
import type { ExtensionCatalog } from "../../extensions/extension-catalog/extension-catalog.js";
import { readInstalledExtensions } from "../../extensions/extension-catalog/read-installed.js";
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
  pending_consent: "needs_review",
  incompatible: "incompatible",
  invalid: "invalid",
  shadowed: "shadowed",
};

const STALE: ConfigurationResource["diagnostics"][number] = {
  level: "warning",
  code: "reload-needed",
  message:
    'The folder on disk is valid now; the diagnostics of the loaded version are out of date. Run `extensions.reload("<id>")` to load it.',
};

/**
 * Extensions as a summary; `extensions.status(id)` has the detail (consent, switch, recent
 * errors). Checking reads the folders on disk without running anything; reloading re-reads
 * and loads every folder of the scope.
 */
export function extensionProvider(options: {
  catalog: Pick<ExtensionCatalog, "entries" | "reload">;
  home: string;
  nerveVersion?: string;
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
          state:
            entry.trustState === "declined" ? "declined" : STATES[entry.state],
          ...(entry.state === "pending_consent" ? { approval: CONSENT } : {}),
          ...(entry.shadowedBy ? { shadowedBy: entry.shadowedBy } : {}),
          diagnostics: entry.diagnostics,
        }),
      );
  }
  const problems = async (context: ResourceContext) =>
    (await all(context)).filter((entry) => entry.diagnostics.length > 0);

  /** The scope's folders as they are on disk now, with the catalog's consent state for the valid ones. */
  async function check(
    context: ResourceContext,
  ): Promise<ConfigurationResource[]> {
    if (context.scope === "project" && !context.projectDirectory) return [];
    const root =
      context.scope === "user"
        ? join(options.home, "agent", "extensions")
        : join(context.projectDirectory!, ".nerve", "extensions");
    const loaded = new Map(
      (await all(context))
        .filter((entry) => entry.scope === context.scope)
        .map((entry) => [entry.path, entry]),
    );
    const found: ConfigurationResource[] = [];
    for (const read of await readInstalledExtensions(
      root,
      options.nerveVersion ?? nerveVersion,
    )) {
      const before = loaded.get(read.folder);
      const base = {
        kind: "extension" as const,
        id: read.manifest?.id ?? read.folderName,
        scope: context.scope,
        path: read.folder,
      };
      if (read.incompatible)
        found.push({
          ...base,
          state: "incompatible",
          diagnostics: [
            {
              level: "error",
              code: "incompatible",
              message: read.incompatible,
            },
          ],
        });
      else if (read.diagnostics.some((entry) => entry.level === "error"))
        found.push({
          ...base,
          state: "invalid",
          diagnostics: read.diagnostics,
        });
      else if (
        !before ||
        before.state === "invalid" ||
        before.state === "incompatible"
      )
        // Valid on disk but not what is loaded: the catalog is stale until a reload.
        found.push({
          ...base,
          state: before?.state ?? "invalid",
          diagnostics: [...read.diagnostics, STALE],
        });
      else if (before.diagnostics.length > 0) found.push(before);
    }
    return found;
  }

  return {
    kinds: ["extension"],
    list: all,
    check,
    async reload(context) {
      await options.catalog.reload();
      return await problems(context);
    },
  };
}
