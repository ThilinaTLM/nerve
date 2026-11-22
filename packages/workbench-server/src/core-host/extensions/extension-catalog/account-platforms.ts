import type { QuickScriptRegistry } from "@nervekit/tools/quick-script";

/** One extension's use of a platform, with who declared it. */
export type PlatformUseEntry = {
  extensionId: string;
  platform: string;
  scopes?: string[];
  origins?: string[];
};

/**
 * Platform uses of every extension in the composed registries. An extension in several
 * compositions counts once. They feed the scope union: a definition's accounts sign in with the
 * scopes of every extension that uses its platform.
 */
export function platformUses(
  composed: ReadonlyMap<string, { registry: QuickScriptRegistry }>,
): PlatformUseEntry[] {
  const seen = new Map<string, PlatformUseEntry>();
  for (const { registry } of composed.values())
    for (const extension of registry.extensions)
      for (const use of extension.uses ?? [])
        seen.set(`${extension.id}\u0000${use.platform}`, {
          extensionId: extension.id,
          ...use,
        });
  return [...seen.values()];
}

/**
 * The name of the extension that defines `kind`: the extension whose id the kind starts with
 * (installed extensions prefix their kinds with their id), the longest match first. Names of
 * extensions the catalog knows, loaded or not.
 */
export function extensionNameOfKind(
  kind: string,
  composed: ReadonlyMap<
    string,
    { entries: readonly { id: string; name?: string | undefined }[] }
  >,
): string | undefined {
  let found: { id: string; name: string } | undefined;
  for (const { entries } of composed.values())
    for (const extension of entries)
      if (
        extension.name &&
        (kind === extension.id || kind.startsWith(`${extension.id}-`)) &&
        (!found || extension.id.length > found.id.length)
      )
        found = { id: extension.id, name: extension.name };
  return found?.name;
}
