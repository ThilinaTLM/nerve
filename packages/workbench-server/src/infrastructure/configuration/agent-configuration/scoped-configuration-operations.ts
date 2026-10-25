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
import {
  diagnostic,
  healthDiagnostics,
  type AgentDocument,
  type ConfigurationDiagnostic,
} from "./document-adapters.js";
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
function unavailableDependencies(
  service: AgentConfigurationService,
  scope: AgentScope,
  document: "agent" | "conversation-defaults",
  path: string,
): { status: "unavailable"; diagnostics: ConfigurationDiagnostic[] } {
  let projectId = scope.scope === "project" ? scope.projectId : undefined;
  let inheritsPreferences = scope.scope !== "conversation";
  if (scope.scope === "conversation") {
    try {
      const owner = service.paths.locations.conversationOwner(
        scope.conversationId,
      );
      projectId = owner.projectId;
      inheritsPreferences = owner.role === "lead";
    } catch {
      // Ownership may itself have changed; retain only the requested scope.
    }
  }
  const diagnostics = service
    .health()
    .filter(
      (issue) =>
        issue.document === document &&
        ((issue.scope === "user" && inheritsPreferences) ||
          (issue.scope === "project" &&
            inheritsPreferences &&
            issue.scopeId === projectId) ||
          (scope.scope === "conversation" &&
            issue.scope === "conversation" &&
            issue.scopeId === scope.conversationId)),
    );
  return {
    status: "unavailable" as const,
    diagnostics: diagnostics.length
      ? diagnostics
      : [
          {
            ...diagnostic(scope, document, path, "dependencies-changing"),
            recoveryChoices: ["retry"],
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
      try {
        return {
          status: "available",
          source: documentSource(state.value),
          overrides: state.value.document.overrides,
          inherited: await service.getInheritedSettings(scope),
        };
      } catch {
        return unavailableDependencies(
          service,
          scope,
          "agent",
          state.value.path,
        );
      }
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
      try {
        const preferences = await service.getCreationPreferences(
          scope.scope === "project" ? scope.projectId : undefined,
        );
        if (preferences.status === "unavailable") return preferences;
        return {
          status: "available",
          source: { ...documentSource(state.value), scope },
          overrides: state.value.document.overrides,
          effective: preferences.overrides,
          inherited: await service.getInheritedCreationPreferences(scope),
          diagnostics: preferences.diagnostics,
        };
      } catch {
        return unavailableDependencies(
          service,
          scope,
          "conversation-defaults",
          state.value.path,
        );
      }
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
