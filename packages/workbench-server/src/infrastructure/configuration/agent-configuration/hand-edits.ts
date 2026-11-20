import type {
  AcceptDocument,
  DocumentIssue,
} from "../scoped-store/scoped-document-store.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";
import {
  issueDiagnostics,
  type AgentDocument,
  type ConfigurationDiagnostic,
  type PreferenceScope,
} from "./document-adapters.js";

/** Facts about other configuration that a hand-edited file is checked against. */
export type HandEditContext = {
  /** Ids of the rule sets that can be selected. */
  ruleSetIds: readonly string[];
};

/**
 * Selecting a rule set that does not exist blocks every tool call, so such a file is treated
 * like an invalid one: it never replaces loaded preferences.
 */
function selectsKnownRuleSet(
  context: HandEditContext,
): AcceptDocument<AgentDocument> {
  return (document) => {
    const id = document.overrides.permissionRuleSetId;
    return id === undefined || context.ruleSetIds.includes(id)
      ? []
      : [
          {
            code: "invalid-value",
            pointer: "/overrides/permissionRuleSetId",
            message: `No selectable rule set has the id "${id}". Available: ${[...context.ruleSetIds].sort().join(", ")}.`,
          },
        ];
  };
}

/** Issues of a file a keep-loaded reload refused to activate, or activated with concerns. */
function reported(result: object): readonly DocumentIssue[] {
  const { rejected, concerns } = result as {
    rejected?: readonly DocumentIssue[];
    concerns?: readonly DocumentIssue[];
  };
  return rejected ?? concerns ?? [];
}

export type HandEditReload = {
  /** Files that are invalid on disk and whose loaded version therefore stays in force. */
  kept: ConfigurationDiagnostic[];
  /** Files that were activated although they will not work, because nothing valid was loaded. */
  concerns: ConfigurationDiagnostic[];
};

/**
 * Reload after hand edits: agent preferences, creation preferences and the profile catalog of
 * one scope, validate-then-activate.
 */
export async function reloadScopeKeepingLoaded(
  service: AgentConfigurationService,
  scope: PreferenceScope,
  context: HandEditContext,
): Promise<HandEditReload> {
  const agent = await service.reload(scope, {
    accept: selectsKnownRuleSet(context),
  });
  const creation = await service.reloadCreation(scope, true);
  const agentIssues = issueDiagnostics(
    scope,
    "agent",
    service.paths.agent(scope),
    reported(agent),
  );
  const activated = "concerns" in agent;
  return {
    concerns: activated ? agentIssues : [],
    kept: [
      ...(activated ? [] : agentIssues),
      ...issueDiagnostics(
        scope,
        "conversation-defaults",
        service.paths.creation(scope),
        reported(creation),
      ),
      ...(await service.profiles.reloadCatalog(scope, true)),
    ],
  };
}

/** Diagnostics of one scope's files as they are on disk; activates nothing. */
export async function inspectScope(
  service: AgentConfigurationService,
  scope: PreferenceScope,
  context: HandEditContext,
): Promise<ConfigurationDiagnostic[]> {
  return [
    ...issueDiagnostics(
      scope,
      "agent",
      service.paths.agent(scope),
      await service.inspectAgent(scope, selectsKnownRuleSet(context)),
    ),
    ...issueDiagnostics(
      scope,
      "conversation-defaults",
      service.paths.creation(scope),
      await service.inspectCreation(scope),
    ),
    ...(await service.profiles.inspect(scope)),
  ];
}
