import type { DocumentIssue } from "../scoped-store/scoped-document-store.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";
import {
  issueDiagnostics,
  type ConfigurationDiagnostic,
  type PreferenceScope,
} from "./document-adapters.js";

/** Issues of a file that a keep-loaded reload refused to activate. */
function rejected(result: object): readonly DocumentIssue[] {
  return (result as { rejected?: readonly DocumentIssue[] }).rejected ?? [];
}

/**
 * Reload after hand edits: agent preferences, creation preferences and the profile catalog of
 * one scope, validate-then-activate. Returns the diagnostics of files that are invalid on disk
 * and whose loaded version therefore stays in force.
 */
export async function reloadScopeKeepingLoaded(
  service: AgentConfigurationService,
  scope: PreferenceScope,
): Promise<ConfigurationDiagnostic[]> {
  const agent = await service.reload(scope, true);
  const creation = await service.reloadCreation(scope, true);
  return [
    ...issueDiagnostics(
      scope,
      "agent",
      service.paths.agent(scope),
      rejected(agent),
    ),
    ...issueDiagnostics(
      scope,
      "conversation-defaults",
      service.paths.creation(scope),
      rejected(creation),
    ),
    ...(await service.profiles.reloadCatalog(scope, true)),
  ];
}

/** Diagnostics of one scope's files as they are on disk; activates nothing. */
export async function inspectScope(
  service: AgentConfigurationService,
  scope: PreferenceScope,
): Promise<ConfigurationDiagnostic[]> {
  return [
    ...issueDiagnostics(
      scope,
      "agent",
      service.paths.agent(scope),
      await service.inspectAgent(scope),
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
