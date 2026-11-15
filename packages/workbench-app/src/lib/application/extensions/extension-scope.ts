import type { ExtensionTarget } from "@nervekit/contracts/extensions";

/**
 * Whether a change to `changed` alters the view of `shown`: the same scope, or
 * the user scope under a project (its inherited values).
 */
export function extensionChangeAffects(
  changed: ExtensionTarget,
  shown: ExtensionTarget,
): boolean {
  if (changed.scope === "user") return shown.scope !== "conversation";
  if (changed.scope === "project")
    return shown.scope === "project" && shown.projectId === changed.projectId;
  return (
    shown.scope === "conversation" &&
    shown.conversationId === changed.conversationId
  );
}
