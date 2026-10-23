import { createHash } from "node:crypto";
import {
  resolveAgentConfiguration,
  profileConfirmationSchema,
  configurationDocumentSourceSchema,
  type AppliedProfile,
  type ProfileTransitionResult,
  type PreviewProfileTransitionResult,
  type ProfileTransitionPreview,
  type ProfileRefreshRequired,
  type ImplementationChoices,
} from "@nervekit/contracts/agent-configuration";
import type {
  CoreStorage,
  ProfileLifecyclePort,
  ProfileTransitionInput,
} from "@nervekit/conversation-core";
import type { ConversationEvent } from "@nervekit/contracts/core";
import { ScopeConflictError } from "../scoped-store/scoped-document-store.js";
import type { AgentConfigurationService } from "./agent-configuration-service.js";
import {
  documentSource,
  effectiveAgent,
} from "./scoped-configuration-operations.js";

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const eventId = (conversationId: string, id: string, stage: string) =>
  `evt_profile_${createHash("sha256")
    .update(JSON.stringify([conversationId, id, stage]))
    .digest("hex")}`;

/** Lifecycle decisions live in existing notification events (not a second configuration store).
 * Text encodes the existing shared confirmation/source DTO; these events never enter model context. */
export function createProfileTransitions(
  service: AgentConfigurationService,
  storage: CoreStorage,
  publish?: (event: ConversationEvent) => void,
) {
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
  function readEvent(id: string, transitionId: string, stage: string) {
    const event = storage.events.get(eventId(id, transitionId, stage));
    return event?.conversationId === id &&
      event.type === "system_event" &&
      event.payload.subtype === "notification"
      ? event
      : undefined;
  }
  function journal(input: ProfileTransitionInput, stage: string, text: string) {
    if (readEvent(input.conversationId, input.transitionId, stage)) return;
    const event = storage.events.append({
      id: eventId(input.conversationId, input.transitionId, stage),
      conversationId: input.conversationId,
      type: "system_event",
      llmRepresentation: "none",
      turnId: null,
      inputId: null,
      payload: {
        subtype: "notification",
        producer: `agent-profile:${input.kind}:${stage}`,
        text,
      },
      createdAt: new Date().toISOString(),
    });
    publish?.(event);
  }
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
    const preview: ProfileTransitionPreview = {
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
  async function appliedResult(
    input: ProfileTransitionInput,
  ): Promise<ProfileTransitionResult | undefined> {
    const accepted = readEvent(
      input.conversationId,
      input.transitionId,
      "accepted",
    );
    if (
      !accepted ||
      accepted.type !== "system_event" ||
      accepted.payload.subtype !== "notification" ||
      !same(JSON.parse(accepted.payload.text), decision(input))
    )
      return;
    const event = readEvent(
      input.conversationId,
      input.transitionId,
      "applied",
    );
    if (
      event?.type === "system_event" &&
      event.payload.subtype === "notification"
    ) {
      const source = configurationDocumentSourceSchema.parse(
        JSON.parse(event.payload.text),
      );
      if (
        source.scope.scope !== "conversation" ||
        source.scope.conversationId !== input.conversationId
      )
        throw new Error("Invalid transition lifecycle source");
      return {
        status: "applied",
        transitionId: input.transitionId,
        source: { ...source, scope: source.scope },
        effective: await effectiveAgent(service, input.conversationId),
      };
    }
    const state = await service.ensureLoaded(scope(input.conversationId));
    if (state.status === "unavailable")
      return unavailable(input.conversationId);
    const document = state.value.document;
    if (
      !("appliedProfile" in document) ||
      document.lastTransition?.id !== input.transitionId ||
      document.lastTransition.kind !== input.kind
    )
      return;
    if (
      document.appliedProfile?.name !== input.targetProfile.name ||
      document.appliedProfile.sourceDigest !== input.targetProfile.digest ||
      state.value.revision !== input.expectedRevision + 1 ||
      Object.entries(input.choices ?? {}).some(
        ([key, value]) =>
          !same(document.overrides[key as keyof ImplementationChoices], value),
      )
    )
      return;
    const source = {
      ...documentSource(state.value),
      scope: scope(input.conversationId),
    };
    journal(input, "applied", JSON.stringify(source));
    return {
      status: "applied",
      transitionId: input.transitionId,
      source,
      effective: await effectiveAgent(service, input.conversationId),
    };
  }
  function decision(input: ProfileTransitionInput) {
    return {
      ...profileConfirmationSchema.parse({
        targetProfile: input.targetProfile,
        expectedRevision: input.expectedRevision,
        expectedDigest: input.expectedDigest,
        transitionId: input.transitionId,
        ...(input.choices ? { choices: input.choices } : {}),
      }),
      kind: input.kind,
      ...(input.action ? { action: input.action } : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    };
  }
  async function reconcile(
    input: ProfileTransitionInput,
  ): Promise<ProfileTransitionResult> {
    const result = await appliedResult(input);
    if (result) return result;
    journal(input, "rejected", JSON.stringify(decision(input)));
    return refresh(input, "configuration_changed");
  }
  async function apply(
    input: ProfileTransitionInput,
  ): Promise<ProfileTransitionResult> {
    const prior = readEvent(
      input.conversationId,
      input.transitionId,
      "accepted",
    );
    if (
      prior?.type === "system_event" &&
      prior.payload.subtype === "notification"
    ) {
      if (!same(JSON.parse(prior.payload.text), decision(input)))
        return refresh(input, "configuration_changed");
      return reconcile(input);
    }
    if (readEvent(input.conversationId, input.transitionId, "rejected"))
      return refresh(input, "configuration_changed");
    journal(input, "accepted", JSON.stringify(decision(input)));
    try {
      const captured = await capture(
        input.conversationId,
        input.targetProfile.name,
      );
      if ("failure" in captured) {
        journal(input, "rejected", JSON.stringify(decision(input)));
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
        journal(input, "rejected", JSON.stringify(decision(input)));
        return refresh(input, failure);
      }
      const committed = await service.commitProfile(
        input.conversationId,
        { revision: input.expectedRevision, digest: input.expectedDigest },
        captured.applied,
        choices,
        { id: input.transitionId, kind: input.kind },
        captured.defaults.isCurrent,
      );
      const source = {
        ...documentSource(committed),
        scope: scope(input.conversationId),
      };
      journal(input, "applied", JSON.stringify(source));
      return {
        status: "applied",
        transitionId: input.transitionId,
        source,
        effective: await effectiveAgent(service, input.conversationId),
      };
    } catch (error) {
      const state = await service.ensureLoaded(scope(input.conversationId));
      if (state.status === "unavailable")
        return unavailable(input.conversationId);
      // A journal failure after the file commit must keep its accepted decision recoverable.
      if (
        "lastTransition" in state.value.document &&
        state.value.document.lastTransition?.id === input.transitionId
      )
        throw error;
      journal(input, "rejected", JSON.stringify(decision(input)));
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
    reject: (input, reason) =>
      serial(input.conversationId, () => {
        journal(input, "rejected", JSON.stringify(decision(input)));
        return refresh(input, reason);
      }),
    apply: (input) => serial(input.conversationId, () => apply(input)),
    reconcile: (input) => serial(input.conversationId, () => reconcile(input)),
  };
  return {
    port,
    reconciled(
      id: string,
      receipt: { id: string; kind: "profile" | "plan-approval" },
    ) {
      if (receipt.kind === "profile")
        return Boolean(readEvent(id, receipt.id, "applied"));
      return storage.events
        .since(id, 0)
        .some(
          (event: ConversationEvent) =>
            event.type === "tool_call_response" &&
            event.payload.interactionResolution?.kind === "plan_review" &&
            event.payload.interactionResolution.decision === "approve" &&
            event.payload.interactionResolution.confirmation.transitionId ===
              receipt.id,
        );
    },
  };
}
