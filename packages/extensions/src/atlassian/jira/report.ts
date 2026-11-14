import type { ExtensionContext } from "@nervekit/extension-api";

/** Lists an entity the run created, updated or deleted in the result footer. */
export function noteChange(
  session: { ctx: ExtensionContext },
  kind: "created" | "updated" | "deleted",
  what: string,
): void {
  session.ctx.report[kind](what);
}
