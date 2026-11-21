import type { Diagnostic } from "../configuration/diagnostic.js";

/** The prefix every tool name of an installed extension starts with: its id with hyphens as underscores, then `_`. */
export function installedToolPrefix(extensionId: string): string {
  return `${extensionId.replaceAll("-", "_")}_`;
}

/**
 * Names an installed (user or project) extension must prefix with its id, so two of a user's own
 * extensions cannot collide: tool names start with `installedToolPrefix(id)`, account kinds with
 * the id. Built-in extensions are exempt. The SDK build and the host share this check.
 */
export function installedNamingDiagnostics(manifest: {
  id: string;
  tools?: readonly { name: string }[];
  accounts?: Readonly<Record<string, unknown>>;
  uses?: readonly { platform: string }[];
  settings?: {
    fields: Readonly<Record<string, { type: string; platform?: string }>>;
  };
}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const toolPrefix = installedToolPrefix(manifest.id);
  for (const tool of manifest.tools ?? [])
    if (!tool.name.startsWith(toolPrefix))
      diagnostics.push({
        level: "error",
        code: "tool-name-prefix",
        message: `The tool '${tool.name}' must start with '${toolPrefix}' (the extension id '${manifest.id}', hyphens as underscores). Rename it, for example '${toolPrefix}${tool.name.replace(/^[a-z]+_/, "")}'.`,
        pointer: `/tools/${tool.name}`,
      });
  for (const kind of Object.keys(manifest.accounts ?? {}))
    if (!kind.startsWith(manifest.id))
      diagnostics.push({
        level: "error",
        code: "account-kind-prefix",
        message: `The account kind '${kind}' must start with the extension id '${manifest.id}'. Rename it, for example '${manifest.id}-${kind}'.`,
        pointer: `/accounts/${kind}`,
      });
  const used = new Set<string>();
  for (const [index, { platform }] of (manifest.uses ?? []).entries()) {
    if (used.has(platform))
      diagnostics.push({
        level: "error",
        code: "platform-use-duplicate",
        message: `The platform '${platform}' is listed twice under \`uses\`. Merge the entries.`,
        pointer: `/uses/${index}`,
      });
    used.add(platform);
  }
  for (const [key, field] of Object.entries(manifest.settings?.fields ?? {}))
    if (
      field.type === "account" &&
      field.platform !== undefined &&
      !used.has(field.platform)
    )
      diagnostics.push({
        level: "error",
        code: "platform-not-used",
        message: `The setting '${key}' names the platform '${field.platform}', which the extension does not list under \`uses\`. Add { platform: "${field.platform}" } to \`uses\`.`,
        pointer: `/settings/fields/${key}/platform`,
      });
  return diagnostics;
}
