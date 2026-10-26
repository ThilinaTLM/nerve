import {
  implementationChoicesSchema,
  resolveAgentConfiguration,
  canonicalSettingsEntries,
  type AppliedProfile,
  type ProfileTransitionResult,
  type PreviewProfileTransitionResult,
  type ProfileTransitionPreview,
  type ProfileRefreshRequired,
} from "@nervekit/contracts/agent-configuration";
import type {
  ProfileLifecyclePort,
  ProfileTransitionInput,
} from "@nervekit/conversation-core";
import { ScopeConflictError } from "../scoped-store/scoped-document-store.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";
import {
  documentSource,
  effectiveAgent,
} from "./scoped-configuration-operations.js";

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
/** Profile saves mutate only agent.json; interrupted approvals require explicit reconfirmation. */
export function createProfileTransitions(service: AgentConfigurationService) {
  const pending = new Map<string, Promise<unknown>>();
  const scope = (id: string) => ({
    scope: "conversation" as const,
    conversationId: id,
  });
  const diagnostics = (id: string, code: string) => [
    {
      scope: "conversation" as const,
      scopeId: id,
      document: "agent",
      path: service.paths.agent(scope(id)),
      code,
      pointer: "/appliedProfile",
      affectedCapability: "profile-transition",
      recoveryChoices: ["retry" as const, "reload" as const],
    },
  ];
  const unavailable = (
    id: string,
  ): Extract<ProfileTransitionResult, { status: "unavailable" }> => ({
    status: "unavailable",
    diagnostics: service.health().filter((issue) => issue.scopeId === id).length
      ? service.health().filter((issue) => issue.scopeId === id)
      : diagnostics(id, "configuration-unavailable"),
  });
  async function capture(id: string, name: string) {
    const current = await service.captureEffective(id);
    if (current.view.status !== "available")
      return { failure: unavailable(id) } as const;
    if (current.view.role !== "lead")
      return {
        failure: {
          status: "refresh_required",
          reason: "requirement_conflict",
          diagnostics: diagnostics(id, "child-profile-switch-unsupported"),
        },
      } as const;
    const source = current.view.sources.find(
      (source) => source.scope.scope === "conversation",
    )!;
    const document = source.document;
    if (!("appliedProfile" in document))
      return { failure: unavailable(id) } as const;
    const defaults = await service.captureDefaults(
      service.paths.locations.conversationOwner(id).projectId,
    );
    const lookup = await service.profiles.get(
      name,
      service.paths.locations.conversationOwner(id).projectId,
      "lead",
    );
    if (lookup.status !== "available")
      return {
        failure: {
          status: "refresh_required",
          reason: lookup.diagnostics.some((issue) =>
            issue.code.includes("untrusted"),
          )
            ? "target_untrusted"
            : "target_unavailable",
          diagnostics: [...lookup.diagnostics],
        } satisfies ProfileRefreshRequired,
      } as const;
    const applied: AppliedProfile = {
      name,
      source: lookup.source,
      sourceDigest: lookup.digest,
      instructions: lookup.definition.instructions,
      recommendations: lookup.definition.recommendations ?? {},
      requirements: lookup.definition.requirements ?? {},
    };
    const resolution = resolveAgentConfiguration({
      ...defaults.options,
      role: "lead",
      conversation: document.overrides,
      appliedProfile: applied,
    });
    const priorResolution = current.view.resolution;
    const previous = new Map(
      canonicalSettingsEntries(priorResolution.settings),
    );
    const next = new Map(canonicalSettingsEntries(resolution.settings));
    const changedFields: ProfileTransitionPreview["changedFields"] = [
      ...new Set([...previous.keys(), ...next.keys()]),
    ]
      .filter(
        (pointer) =>
          !same(previous.get(pointer), next.get(pointer)) ||
          !same(
            priorResolution.provenance[pointer],
            resolution.provenance[pointer],
          ),
      )
      .map((pointer) => ({
        pointer,
        before: previous.get(pointer) ?? null,
        after: next.get(pointer) ?? null,
        beforeSource: priorResolution.provenance[pointer],
        afterSource: resolution.provenance[pointer],
      }));
    if (!same(document.appliedProfile?.instructions, applied.instructions))
      changedFields.push({
        pointer: "/appliedProfile/instructions",
        before: document.appliedProfile?.instructions ?? null,
        after: applied.instructions,
        beforeSource: undefined,
        afterSource: undefined,
      });
    const unchangedRequirements = canonicalSettingsEntries(applied.requirements)
      .filter(
        ([pointer, value]) =>
          same(previous.get(pointer), value) &&
          same(
            priorResolution.provenance[pointer],
            resolution.provenance[pointer],
          ),
      )
      .map(([pointer, value]) => ({ pointer, value }));
    const preview: ProfileTransitionPreview = {
      targetDefinition: structuredClone(lookup.definition),
      changedFields,
      unchangedRequirements,
      targetProfile: { name, digest: lookup.digest },
      source: lookup.source,
      expectedRevision: source.revision,
      expectedDigest: source.digest,
      recommendations: applied.recommendations,
      requirements: applied.requirements,
      resolution,
    };
    return { current, defaults, source, document, applied, preview };
  }
  async function preview(
    id: string,
    name: string,
  ): Promise<PreviewProfileTransitionResult> {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const captured = await capture(id, name);
        if ("failure" in captured) return captured.failure!;
        if (!captured.current.isCurrent() || !captured.defaults.isCurrent())
          continue;
        return { status: "ready", preview: captured.preview };
      }
      return {
        status: "refresh_required",
        reason: "configuration_changed",
        diagnostics: diagnostics(id, "dependencies-changing"),
      };
    } catch {
      return unavailable(id);
    }
  }
  async function refresh(
    input: ProfileTransitionInput,
    reason: ProfileRefreshRequired["reason"],
  ): Promise<ProfileTransitionResult> {
    const latest = await preview(
      input.conversationId,
      input.targetProfile.name,
    );
    if (latest.status === "ready")
      return {
        status: "refresh_required",
        reason,
        diagnostics: [],
        preview: latest.preview,
      };
    return latest;
  }
  async function apply(
    input: ProfileTransitionInput,
  ): Promise<ProfileTransitionResult> {
    implementationChoicesSchema.optional().parse(input.choices);
    try {
      const captured = await capture(
        input.conversationId,
        input.targetProfile.name,
      );
      if ("failure" in captured) {
        return captured.failure!;
      }
      let failure: ProfileRefreshRequired["reason"] | undefined;
      if (captured.applied.sourceDigest !== input.targetProfile.digest)
        failure = "target_changed";
      else if (
        captured.source.revision !== input.expectedRevision ||
        captured.source.digest !== input.expectedDigest
      )
        failure = "configuration_changed";
      else if (
        input.action === "reapply" &&
        captured.document.appliedProfile?.name !== input.targetProfile.name
      )
        failure = "configuration_changed";
      const choices = input.choices ?? {};
      for (const key of ["model", "reasoningLevel"] as const)
        if (
          choices[key] !== undefined &&
          captured.applied.requirements[key] !== undefined &&
          !same(choices[key], captured.applied.requirements[key])
        )
          failure = "requirement_conflict";
      const resolution = resolveAgentConfiguration({
        ...captured.defaults.options,
        role: "lead",
        conversation: { ...captured.document.overrides, ...choices },
        appliedProfile: captured.applied,
      });
      if (
        resolution.diagnostics.some(
          (issue) =>
            issue.code === "unsupported-reasoning" ||
            (input.kind === "plan-approval" &&
              (issue.code === "model-required" ||
                (issue.code === "missing-reference" &&
                  issue.pointer === "/model"))),
        )
      )
        failure = "requirement_conflict";
      if (!captured.current.isCurrent() || !captured.defaults.isCurrent())
        failure = "configuration_changed";
      if (failure) {
        return refresh(input, failure);
      }
      const committed = await service.commitProfile(
        input.conversationId,
        { revision: input.expectedRevision, digest: input.expectedDigest },
        captured.applied,
        choices,
        captured.defaults.isCurrent,
      );
      const source = {
        ...documentSource(committed),
        scope: scope(input.conversationId),
      };
      return {
        status: "applied",
        source,
        effective: await effectiveAgent(service, input.conversationId),
      };
    } catch (error) {
      const state = await service.ensureLoaded(scope(input.conversationId));
      if (state.status === "unavailable")
        return unavailable(input.conversationId);
      if (error instanceof ScopeConflictError)
        return refresh(input, "configuration_changed");
      throw error;
    }
  }
  const serial = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const task = (pending.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(work);
    pending.set(id, task);
    void task
      .finally(() => {
        if (pending.get(id) === task) pending.delete(id);
      })
      .catch(() => undefined);
    return task;
  };
  const port: ProfileLifecyclePort = {
    preview,
    apply: (input) => serial(input.conversationId, () => apply(input)),
  };
  return { port };
}
