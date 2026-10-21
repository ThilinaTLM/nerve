import type { ConversationConfig } from "@nervekit/contracts/core";
import type { AgentProfileLockedScalars } from "../ports.js";

export function effectivePermissionRuleSetId(
  config: Pick<ConversationConfig, "permissionRuleSetId">,
  locked?: AgentProfileLockedScalars,
): string {
  return locked?.permissionRuleSetId ?? config.permissionRuleSetId;
}
