import type { ExtensionCatalogEntry } from "@nervekit/contracts/extensions";
import type {
  ExtensionAgentError,
  ExtensionAgentStatus,
} from "@nervekit/tools/extension-host";

/** How one extension fares at a project, as `extensions.status(id)` reports it to the agent. */
export function extensionAgentStatus(
  id: string,
  catalog: readonly ExtensionCatalogEntry[],
  /** The extension's own switch at the project; undefined when unknown. */
  on: boolean | undefined,
  recentErrors: ExtensionAgentError[],
): ExtensionAgentStatus {
  const entries = catalog.filter((entry) => entry.id === id);
  const entry =
    entries.find((candidate) => candidate.state !== "shadowed") ?? entries[0];
  if (!entry)
    return { id, state: "not_found", diagnostics: [], recentErrors: [] };
  return {
    id,
    state: entry.state,
    source: entry.source,
    ...(entry.path ? { folder: entry.path } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    ...(entry.sdkVersion ? { sdkVersion: entry.sdkVersion } : {}),
    consent:
      entry.source === "builtin"
        ? "not_required"
        : entry.state === "pending_consent"
          ? "pending"
          : entry.state === "enabled"
            ? "granted"
            : "unknown",
    ...(entry.state === "enabled"
      ? { switch: on === undefined ? "unknown" : on ? "on" : "off" }
      : {}),
    diagnostics: entry.diagnostics,
    recentErrors,
  };
}
