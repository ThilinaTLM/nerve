import type { ConversationConfig } from "@nervekit/contracts/core";

export function effectivePermissionRuleSetId(
  config: Pick<ConversationConfig, "mode" | "permissionRuleSetId">,
): string {
  return config.mode === "planning" ? "planning" : config.permissionRuleSetId;
}
