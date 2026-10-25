import {
  resolveAgentConfiguration,
  type AppliedProfile,
  type ProjectAgentDefaultsResult,
  type ResolveProjectAgentRequest,
} from "@nervekit/contracts/agent-configuration";
import {
  freezeJson,
  ScopeUnavailableError,
} from "../scoped-store/scoped-document-store.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";

type Capture = {
  view: ProjectAgentDefaultsResult;
  isCurrent(): boolean;
};

/** Disposable, process-local projections of the configuration authority. Only
 * unmodified project defaults are cached; draft choices never pollute them. */
export class ProjectAgentDefaults {
  private readonly cached = new Map<string, Capture>();
  private readonly pending = new Map<string, Promise<Capture>>();

  constructor(private readonly service: AgentConfigurationService) {}

  async get(
    input: ResolveProjectAgentRequest,
  ): Promise<ProjectAgentDefaultsResult> {
    try {
      return (await this.capture(input)).view;
    } catch (error) {
      if (!(error instanceof ScopeUnavailableError)) throw error;
      const diagnostics = this.service
        .health()
        .filter(
          (issue) =>
            issue.scope === "user" ||
            (issue.scope === "project" && issue.scopeId === input.projectId),
        );
      return {
        status: "unavailable",
        diagnostics: diagnostics.length
          ? diagnostics
          : [
              {
                scope: "project",
                scopeId: input.projectId,
                document: "agent",
                path: "config/agent.json",
                code: "dependencies-changing",
                pointer: "",
                affectedCapability: "agent-configuration",
                recoveryChoices: ["retry"],
              },
            ],
      };
    }
  }

  async capture(input: ResolveProjectAgentRequest): Promise<Capture> {
    if (input.agentProfile || Object.keys(input.overrides ?? {}).length)
      return this.resolve(input);
    const existing = this.cached.get(input.projectId);
    if (existing?.isCurrent()) return existing;
    let loading = this.pending.get(input.projectId);
    if (!loading) {
      loading = this.resolve(input);
      this.pending.set(input.projectId, loading);
    }
    try {
      const capture = await loading;
      if (capture.view.status === "available" && capture.isCurrent())
        this.cached.set(input.projectId, capture);
      return capture;
    } finally {
      if (this.pending.get(input.projectId) === loading)
        this.pending.delete(input.projectId);
    }
  }

  private async resolve(input: ResolveProjectAgentRequest): Promise<Capture> {
    const { projectId } = input;
    for (let attempt = 0; attempt < 3; attempt++) {
      const defaults = await this.service.captureDefaults(projectId);
      const creation = await this.service.captureCreationPreferences(projectId);
      if (creation.view.status === "unavailable")
        return { view: creation.view, isCurrent: () => false };
      const profile = await this.service.profiles.get(
        input.agentProfile?.name ?? creation.view.overrides.defaultAgentProfile,
        projectId,
      );
      if (profile.status === "unavailable")
        return {
          view: {
            status: "unavailable",
            diagnostics: [...profile.diagnostics],
          },
          isCurrent: () => false,
        };
      if (input.agentProfile && profile.digest !== input.agentProfile.digest)
        return {
          view: {
            status: "unavailable",
            diagnostics: [
              {
                scope: "project",
                scopeId: projectId,
                document: "profile",
                path: "agent-profiles",
                code: "target-changed",
                pointer: "",
                affectedCapability: "agent-configuration",
                recoveryChoices: ["retry"],
              },
            ],
          },
          isCurrent: () => false,
        };
      const isCurrent = () => defaults.isCurrent() && creation.isCurrent();
      // Loading a profile can advance the catalog generation. Capture again
      // rather than publish a result whose dependencies are already outdated.
      if (!isCurrent()) continue;
      const definition = profile.definition;
      const appliedProfile: AppliedProfile = {
        name: definition.name,
        source: profile.source,
        sourceDigest: profile.digest,
        instructions: definition.instructions,
        recommendations: definition.recommendations ?? {},
        requirements: definition.requirements ?? {},
      };
      return {
        view: freezeJson({
          status: "available",
          appliedProfile,
          resolution: resolveAgentConfiguration({
            ...defaults.options,
            role: "lead",
            conversation: input.overrides ?? {},
            appliedProfile,
          }),
          diagnostics: [...creation.view.diagnostics, ...profile.diagnostics],
        }),
        isCurrent,
      };
    }
    throw new Error("Project configuration changed during resolution. Retry.");
  }
}
