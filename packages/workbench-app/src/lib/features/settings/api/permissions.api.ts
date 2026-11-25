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

/**
 * Declines the project's permissions file (also how a trusted one is revoked).
 * `path` is the file as the daemon names it: the `resourceKey` of the decision.
 */
export async function declineProjectPermissionTrust(
  projectId: string,
  path: string,
  contentDigest: string,
): Promise<PermissionPolicyConfiguration> {
  await requestConversation("trust.decide", {
    kind: "project_permissions",
    projectId,
    resourceKey: path,
    name: null,
    contentDigest,
    status: "rejected",
  });
  return getPermissionConfiguration(projectId);
}

/** Where the daemon keeps the decision on the project's permissions file, if it has one. */
export async function projectPermissionTrustKey(
  projectId: string,
): Promise<string | undefined> {
  const [record] = await requestConversation("trust.list", {
    projectId,
    kind: "project_permissions",
  });
  return record?.resourceKey;
}
