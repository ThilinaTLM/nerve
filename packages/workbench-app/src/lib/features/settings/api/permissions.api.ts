import type {
  PermissionPolicyConfiguration,
  PermissionRule,
} from "@nervekit/contracts/permissions";
import { requestConversation } from "$lib/application/startup/conversation-connection";

export type PermissionRuleTarget = {
  scope: "user" | "project";
  projectId?: string;
  ruleSetId: string;
};

export function getPermissionConfiguration(
  projectId?: string,
): Promise<PermissionPolicyConfiguration> {
  return requestConversation("permission.configuration.get", { projectId });
}

export function savePermissionRule(
  target: PermissionRuleTarget,
  rule: PermissionRule,
  previousRuleId?: string,
): Promise<PermissionPolicyConfiguration> {
  return requestConversation("permission.rule.save", {
    ...target,
    rule,
    previousRuleId,
  });
}

export function deletePermissionRule(
  target: PermissionRuleTarget,
  ruleId: string,
): Promise<PermissionPolicyConfiguration> {
  return requestConversation("permission.rule.delete", { ...target, ruleId });
}

export function grantProjectPermissionTrust(
  projectId: string,
): Promise<PermissionPolicyConfiguration> {
  return requestConversation("permission.projectTrust.grant", { projectId });
}
