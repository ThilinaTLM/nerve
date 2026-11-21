import type { AccountKind } from "@nervekit/contracts/extensions";
import type { QuickScriptRegistry } from "@nervekit/tools/quick-script";

/**
 * Account kinds of the composed registries (keyed by project directory, "" for none). A kind a
 * project's own extension defines carries that project's directory key; the others (built-in,
 * user) are available everywhere. Kinds are unique across built-ins and user extensions; two
 * projects may each define the same name.
 */
export function accountDefinitions(
  composed: ReadonlyMap<string, { registry: QuickScriptRegistry }>,
): { kind: AccountKind; projectDir?: string }[] {
  const global = new Map<string, AccountKind>();
  const perProject = new Map<
    string,
    { kind: AccountKind; projectDir: string }
  >();
  for (const [key, { registry }] of composed)
    for (const extension of registry.extensions)
      for (const kind of extension.accounts ?? []) {
        if (extension.source === "project")
          perProject.set(`${key}\u0000${kind.kind}`, { kind, projectDir: key });
        else if (!global.has(kind.kind)) global.set(kind.kind, kind);
      }
  return [
    ...[...global.values()].map((kind) => ({ kind })),
    ...perProject.values(),
  ];
}
