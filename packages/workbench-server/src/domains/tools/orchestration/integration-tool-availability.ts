import type { CapabilityToolName } from "@nervekit/contracts/capabilities";

export type IntegrationToolName = "jira" | "confluence";

/**
 * Provider setup is always user-owned, while enablement may be overridden by
 * the resolved project/conversation capability selection.
 */
export function integrationToolEnabled(input: {
  name: IntegrationToolName;
  settings: { enabled: boolean; profileId?: string };
  disabledToolNames?: readonly CapabilityToolName[];
}): boolean {
  if (!input.settings.profileId) return false;
  if (input.disabledToolNames !== undefined)
    return !input.disabledToolNames.includes(input.name);
  return input.settings.enabled;
}
