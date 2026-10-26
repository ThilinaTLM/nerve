import type { ConversationConfig } from "@nervekit/contracts/core";

/** Applied profile permissions are ordinary persisted config, not a live overlay. */
export function effectivePermissionRuleSetId(
  config: Pick<ConversationConfig, "permissionRuleSetId">,
): string {
  return config.permissionRuleSetId;
}
