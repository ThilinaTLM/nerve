import {
  ScopeUnavailableError,
  type ScopeGeneration,
  type ScopeHealth,
} from "../scoped-store/scoped-document-store.js";
import type { AgentConfigurationServiceOptions } from "./agent-configuration-service.js";
import type { AgentDocument, AgentScope } from "./document-adapters.js";

/** Resolution may omit a broken project override, not a required user/conversation
 * document. This projection never makes the unavailable store generation writable. */
export function applicableAgentLayers(
  options: Pick<AgentConfigurationServiceOptions, "isProjectAgentTrusted">,
  states: readonly (ScopeHealth<AgentScope, AgentDocument> | undefined)[],
): ScopeGeneration<AgentScope, AgentDocument>[] {
  return states.flatMap((state) => {
    if (state?.status === "unavailable" && state.scope.scope === "project")
      return [];
    if (!state || state.status === "unavailable")
      throw new ScopeUnavailableError();
    const value = state.value;
    if (
      value.scope.scope === "project" &&
      value.digest !== "missing" &&
      options.isProjectAgentTrusted &&
      !options.isProjectAgentTrusted(
        value.scope.projectId,
        value.path,
        value.digest,
      )
    )
      return [];
    return [value];
  });
}
