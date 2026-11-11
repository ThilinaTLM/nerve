import {
  leadSettingsOverridesSchema,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
import {
  accountKind,
  quickScriptIntegrations,
  toolRows,
  type AccountKind,
  type ToolId,
  type ToolPayload,
} from "../tools/tool-settings";

type QuickScriptIntegrationId = (typeof quickScriptIntegrations)[number]["id"];

/** A place an integration account can be used: a tool or a quick_script integration. */
export type AccountConsumer = {
  label: string;
  tool: ToolId;
  integration?: QuickScriptIntegrationId;
};

export type ResolvedTools = Partial<Record<ToolId, ToolPayload>>;

/** Every tool, then every quick_script integration, that signs in with this kind. */
export function accountConsumers(kind: AccountKind): AccountConsumer[] {
  return [
    ...toolRows
      .filter((row) => accountKind(row.id) === kind)
      .map((row) => ({ label: row.label, tool: row.id })),
    ...quickScriptIntegrations
      .filter((i) => i.kind === kind)
      .map((i) => ({
        label: `Quick script (${i.label})`,
        tool: "quick_script" as const,
        integration: i.id,
      })),
  ];
}

type Selection = { enabled?: boolean; profileId?: string };
function selection(consumer: AccountConsumer, tools: ResolvedTools) {
  const payload = tools[consumer.tool] ?? {};
  if (!consumer.integration) return payload as Selection;
  const settings = (payload.settings ?? {}) as Record<string, Selection>;
  const chosen = settings[consumer.integration] ?? {};
  return {
    enabled: payload.enabled === true && chosen.enabled === true,
    profileId: chosen.profileId,
  };
}

export type AccountUsage = {
  /** Turned on with an existing account: the agent can use these now. */
  inUse: { label: string; accountId: string }[];
  /** Off or missing an account: configure them in Tools to use an account. */
  available: string[];
};

export function accountUsage(
  kind: AccountKind,
  tools: ResolvedTools,
  accountIds: readonly string[],
): AccountUsage {
  const usage: AccountUsage = { inUse: [], available: [] };
  for (const consumer of accountConsumers(kind)) {
    const { enabled, profileId } = selection(consumer, tools);
    if (enabled && profileId && accountIds.includes(profileId))
      usage.inUse.push({ label: consumer.label, accountId: profileId });
    else usage.available.push(consumer.label);
  }
  return usage;
}

/** Whether every consumer of this kind already selects the account. */
export function accountUsedEverywhere(
  kind: AccountKind,
  tools: ResolvedTools,
  accountId: string,
): boolean {
  return accountConsumers(kind).every(
    (consumer) => selection(consumer, tools).profileId === accountId,
  );
}

/** Selects the account for every consumer of its kind; never turns anything on or off. */
export function useAccountEverywhere(
  kind: AccountKind,
  accountId: string,
): LeadSettingsOverrides {
  const tools: Record<string, unknown> = {};
  const quickScript: Record<string, { profileId: string }> = {};
  for (const consumer of accountConsumers(kind)) {
    if (consumer.integration)
      quickScript[consumer.integration] = { profileId: accountId };
    else tools[consumer.tool] = { profileId: accountId };
  }
  if (Object.keys(quickScript).length)
    tools.quick_script = { settings: quickScript };
  return leadSettingsOverridesSchema.parse({ tools });
}
