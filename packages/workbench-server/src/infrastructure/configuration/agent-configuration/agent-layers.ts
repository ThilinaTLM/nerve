import {
  ScopeUnavailableError,
  type ScopeGeneration,
  type ScopeHealth,
} from "../scoped-store/scoped-document-store.js";
import { agentDocumentTrustState } from "./agent-document-transactions.js";
import {
  diagnostic,
  type ConfigurationDiagnostic,
} from "./document-adapters.js";
import type { AgentConfigurationPaths } from "./document-adapters.js";
import type { AgentConfigurationServiceOptions } from "./agent-configuration-service.js";
import type { AgentDocument, AgentScope } from "./document-adapters.js";

/**
 * The last user `agent.json` the user trusted, per service. A hand edit that waits for review
 * never replaces it, like a file that is invalid on disk (docs/architecture/trust.md).
 */
const lastTrustedUser = new WeakMap<
  object,
  Map<string, ScopeGeneration<AgentScope, AgentDocument>>
>();

/**
 * The user's own layer: the loaded file when its exact bytes are trusted, else the last trusted
 * version this process held, else none (the defaults apply). `pending` says the file on disk
 * waits for the user.
 */
export function userAgentLayer(
  options: Pick<AgentConfigurationServiceOptions, "agentTrustState">,
  value: ScopeGeneration<AgentScope, AgentDocument>,
): {
  layer: ScopeGeneration<AgentScope, AgentDocument> | undefined;
  pending: boolean;
} {
  const memory = lastTrustedUser.get(options) ?? new Map();
  lastTrustedUser.set(options, memory);
  if (
    value.digest === "missing" ||
    !options.agentTrustState ||
    options.agentTrustState(null, value.path, value.digest) === "trusted"
  ) {
    memory.set(value.path, value);
    return { layer: value, pending: false };
  }
  return { layer: memory.get(value.path), pending: true };
}

/** Resolution may omit a broken project override, not a required user/conversation
 * document. This projection never makes the unavailable store generation writable. */
export function applicableAgentLayers(
  options: Pick<AgentConfigurationServiceOptions, "agentTrustState">,
  states: readonly (ScopeHealth<AgentScope, AgentDocument> | undefined)[],
): ScopeGeneration<AgentScope, AgentDocument>[] {
  return states.flatMap((state) => {
    if (state?.status === "unavailable" && state.scope.scope === "project")
      return [];
    if (!state || state.status === "unavailable")
      throw new ScopeUnavailableError();
    const value = state.value;
    if (value.scope.scope === "user") {
      const { layer } = userAgentLayer(options, value);
      return layer ? [layer] : [];
    }
    if (
      value.scope.scope === "project" &&
      value.digest !== "missing" &&
      options.agentTrustState &&
      options.agentTrustState(
        value.scope.projectId,
        value.path,
        value.digest,
      ) !== "trusted"
    )
      return [];
    return [value];
  });
}

/**
 * The layers a conversation's effective view resolves from, with the diagnostics of files that
 * wait for the user. A project file that is not trusted contributes nothing; a user file that
 * waits never replaces the last version the user trusted.
 */
export function effectiveAgentLayers(
  options: AgentConfigurationServiceOptions,
  paths: AgentConfigurationPaths,
  states: readonly ScopeHealth<AgentScope, AgentDocument>[],
  diagnostics: ConfigurationDiagnostic[],
): ScopeGeneration<AgentScope, AgentDocument>[] {
  return states.flatMap((state) => {
    if (state.status === "unavailable" && state.scope.scope === "project")
      return [];
    const scope =
      state.status === "unavailable" ? state.scope : state.value.scope;
    const trust = agentDocumentTrustState(options, paths, state);
    if (scope.scope === "project" && trust !== "trusted") {
      diagnostics.push(
        diagnostic(
          scope,
          "agent",
          paths.agent(scope),
          trust === "declined" ? "project-declined" : "project-needs-review",
        ),
      );
      return [
        {
          scope,
          path: paths.agent(scope),
          generation:
            state.status === "unavailable"
              ? state.generation
              : state.value.generation,
          revision: 0,
          digest:
            state.status === "unavailable"
              ? state.sourceDigest!
              : state.value.digest,
          document: {
            schemaVersion: 1 as const,
            revision: 0,
            overrides: {},
          },
        },
      ];
    }
    if (state.status === "unavailable") return [];
    if (scope.scope !== "user") return [state.value];
    const { layer, pending } = userAgentLayer(options, state.value);
    if (pending)
      diagnostics.push(
        diagnostic(
          scope,
          "agent",
          state.value.path,
          trust === "declined" ? "declined" : "needs-review",
        ),
      );
    return layer ? [layer] : [];
  });
}
