import type {
  AgentScope,
  ConfigurationDocumentSource,
  GetAgentConfigurationResult,
  GetCreationPreferencesResult,
  SaveAgentConfigurationRequest,
  SaveCreationPreferencesRequest,
  SaveAgentConfigurationResult,
  SaveCreationPreferencesResult,
  EffectiveAgentView,
  ConfigurationMutationFailure,
} from "@nervekit/contracts/agent-configuration";
import { ScopeConflictError } from "../scoped-store/scoped-document-store.js";
import { healthDiagnostics, type AgentDocument } from "./document-adapters.js";
import type { ScopeGeneration } from "../scoped-store/scoped-document-store.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";

export function documentSource(
  value: Omit<ScopeGeneration<AgentScope, AgentDocument>, "document">,
): ConfigurationDocumentSource {
  return {
    scope: value.scope,
    path: value.path,
    generation: value.generation,
    revision: value.revision,
    digest: value.digest,
  };
}
export async function effectiveAgent(
  service: AgentConfigurationService,
  id: string,
): Promise<EffectiveAgentView> {
  const view = await service.getEffective(id);
  if (view.status === "unavailable")
    return { ...view, diagnostics: [...view.diagnostics] };
  const document = view.sources.find(
    (source) => source.scope.scope === "conversation",
  )?.document;
  return {
    status: "available",
    conversationId: id,
    role: view.role,
    appliedProfile:
      document && "appliedProfile" in document ? document.appliedProfile : null,
    resolution: view.resolution,
    diagnostics: [...view.diagnostics],
    sources: view.sources.map(documentSource),
  };
}
export function mutationFailure(
  service: AgentConfigurationService,
  scope: AgentScope,
  error?: unknown,
): ConfigurationMutationFailure {
  const diagnostics = service
    .health()
    .filter(
      (issue) =>
        issue.scope === scope.scope &&
        (scope.scope === "user" ||
          issue.scopeId ===
            (scope.scope === "project"
              ? scope.projectId
              : scope.conversationId)),
    );
  if (error instanceof ScopeConflictError)
    return { status: "conflict", diagnostics };
  return {
    status: diagnostics.length ? "unavailable" : "invalid",
    diagnostics: diagnostics.length
      ? diagnostics
      : [
          {
            scope: scope.scope,
            ...(scope.scope !== "user"
              ? {
                  scopeId:
                    scope.scope === "project"
                      ? scope.projectId
                      : scope.conversationId,
                }
              : {}),
            document: "agent",
            path: service.paths.agent(scope),
            code: "invalid-mutation",
            pointer: "",
            affectedCapability: "agent-configuration",
            recoveryChoices: ["retry", "reload", "repair"],
          },
        ],
  };
}
export function agentConfigurationOperations(
  service: AgentConfigurationService,
) {
  return {
    async get(scope: AgentScope): Promise<GetAgentConfigurationResult> {
      const state = await service.ensureLoaded(scope);
      if (state.status === "unavailable")
        return {
          status: "unavailable",
          diagnostics: healthDiagnostics(state, "agent"),
        };
      return {
        status: "available",
        source: documentSource(state.value),
        overrides: state.value.document.overrides,
      };
    },
    async save({
      scope,
      ...mutation
    }: SaveAgentConfigurationRequest): Promise<SaveAgentConfigurationResult> {
      try {
        const result = await service.save(scope, mutation);
        return {
          status: "saved",
          source: documentSource(result.value),
          overrides: result.value.document.overrides,
        };
      } catch (error) {
        return mutationFailure(service, scope, error);
      }
    },
    effective: (id: string) => effectiveAgent(service, id),
    async creation(
      scope: SaveCreationPreferencesRequest["scope"],
    ): Promise<GetCreationPreferencesResult> {
      const state = await service.loadCreation(scope);
      if (state.status === "unavailable")
        return {
          status: "unavailable",
          diagnostics: healthDiagnostics(state, "conversation-defaults"),
        };
      const preferences = await service.getCreationPreferences(
        scope.scope === "project" ? scope.projectId : undefined,
      );
      if (preferences.status === "unavailable") return preferences;
      return {
        status: "available",
        source: { ...documentSource(state.value), scope },
        overrides: state.value.document.overrides,
        effective: preferences.overrides,
        diagnostics: preferences.diagnostics,
      };
    },
    async saveCreation({
      scope,
      ...mutation
    }: SaveCreationPreferencesRequest): Promise<SaveCreationPreferencesResult> {
      try {
        const result = await service.saveCreation(scope, mutation);
        return {
          status: "saved",
          source: { ...documentSource(result.value), scope },
          overrides: result.value.document.overrides,
        };
      } catch (error) {
        return mutationFailure(service, scope, error);
      }
    },
  };
}
