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
  return diagnostics;
}
