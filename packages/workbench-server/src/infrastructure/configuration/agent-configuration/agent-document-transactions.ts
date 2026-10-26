import { withoutLegacyTransition } from "./document-adapters.js";
import {
  agentMutationSchema,
  conversationDefaultsSchema,
  childConversationAgentSchema,
  leadConversationAgentSchema,
  applySettingsMutation,
  resolveAgentConfiguration,
  normalizeSettingsOverrides,
  resolveInheritedConversationSettings,
  type ResolutionResult,
} from "@nervekit/contracts/agent-configuration";
import {
  ScopeUnavailableError,
  digestBytes,
  type ScopedDocumentStore,
  type ScopeGeneration,
  type ScopeHealth,
} from "../scoped-store/scoped-document-store.js";
import type {
  AgentScope,
  AgentDocument,
  AgentConfigurationPaths,
  CreationPreferences,
} from "./document-adapters.js";
import type {
  AgentConfigurationServiceOptions,
  ResourceSnapshot,
} from "./agent-configuration-service.js";
export interface TransactionPort {
  store: ScopedDocumentStore<AgentScope, AgentDocument>;
  options: AgentConfigurationServiceOptions;
  captureResources(
    projectId?: string,
    role?: "lead" | "child",
  ): Promise<ResourceSnapshot>;
  dependencies(id: string): AgentScope[];
  load(scope: AgentScope): Promise<ScopeHealth<AgentScope, AgentDocument>>;
  resolve(
    id: string,
    values: readonly ScopeGeneration<AgentScope, AgentDocument>[],
    resources: ResourceSnapshot,
    candidate?: AgentDocument,
  ): ResolutionResult;
}
export async function saveAgentDocument(
  port: TransactionPort,
  scope: AgentScope,
  input: unknown,
) {
  const mutation = agentMutationSchema.parse(input);
  if (
    scope.scope === "conversation" &&
    port.options.conversationOwner(scope.conversationId).role === "child"
  )
    throw new Error("Child preference editing is not supported");
  const dependencies: AgentScope[] =
    scope.scope === "conversation"
      ? port.dependencies(scope.conversationId)
      : scope.scope === "project"
        ? [{ scope: "user" }, scope]
        : [scope];
  await Promise.all(dependencies.map((dependency) => port.load(dependency)));
  const resources = await port.captureResources(
    scope.scope === "project"
      ? scope.projectId
      : scope.scope === "conversation"
        ? port.options.conversationOwner(scope.conversationId).projectId
        : undefined,
  );
  const result = await port.store.save(
    scope,
    { revision: mutation.expectedRevision, digest: mutation.expectedDigest },
    (document) => {
      let candidate: AgentDocument = {
        ...withoutLegacyTransition(document),
        overrides: applySettingsMutation(document.overrides, mutation),
      };
      const values = dependencies
        .map((dependency) => port.store.peek(dependency))
        .flatMap((state) => {
          if (!state || state.status === "unavailable")
            throw new ScopeUnavailableError();
          return [state.value];
        });
      candidate = normalizeAgentDocument(
        port,
        scope,
        candidate,
        values,
        resources,
      );
      const resolution =
        scope.scope === "conversation"
          ? port.resolve(scope.conversationId, values, resources, candidate)
          : resolveAgentConfiguration({
              ...resources.options,
              role: "lead",
              user:
                scope.scope === "user"
                  ? candidate.overrides
                  : values.find((value) => value.scope.scope === "user")
                      ?.document.overrides,
              ...(scope.scope === "project"
                ? { project: candidate.overrides }
                : {}),
            });
      validateAgentResolution(resolution, resources);
      return candidate;
    },
  );
  return result;
}
export async function readInheritedAgentSettings(
  port: TransactionPort & { paths: AgentConfigurationPaths },
  scope: AgentScope,
) {
  const projectId =
    scope.scope === "project"
      ? scope.projectId
      : scope.scope === "conversation"
        ? port.options.conversationOwner(scope.conversationId).projectId
        : undefined;
  if (projectId) await port.options.prepareResources?.(projectId);
  const scopes: AgentScope[] =
    scope.scope === "conversation"
      ? port.dependencies(scope.conversationId)
      : scope.scope === "project"
        ? [{ scope: "user" }, scope]
        : [scope];
  await Promise.all(scopes.map((dependency) => port.load(dependency)));
  const values = scopes.flatMap((dependency) => {
    const state = port.store.peek(dependency);
    if (
      state &&
      scope.scope === "conversation" &&
      isUntrustedAgentDocument(port.options, port.paths, state)
    )
      return [];
    if (!state || state.status === "unavailable")
      throw new ScopeUnavailableError();
    return [state.value];
  });
  const document = port.store.peek(scope);
  if (!document || document.status === "unavailable")
    throw new ScopeUnavailableError();
  return inheritedAgentSettings(
    port,
    scope,
    document.value.document,
    values,
    await port.captureResources(
      projectId,
      scope.scope === "conversation"
        ? port.options.conversationOwner(scope.conversationId).role
        : "lead",
    ),
  );
}

/** Compare only against layers below the edited scope, never higher locks. */
export function inheritedAgentSettings(
  port: Pick<TransactionPort, "options">,
  scope: AgentScope,
  document: AgentDocument,
  values: readonly ScopeGeneration<AgentScope, AgentDocument>[],
  resources: ResourceSnapshot,
): ResolutionResult["settings"] {
  if (scope.scope === "conversation" && "appliedProfile" in document) {
    const role = port.options.conversationOwner(scope.conversationId).role;
    const project = values.find((value) => value.scope.scope === "project");
    const trustedProject =
      project &&
      project.scope.scope === "project" &&
      (!port.options.isProjectAgentTrusted ||
        port.options.isProjectAgentTrusted(
          project.scope.projectId,
          project.path,
          project.digest,
        ));
    return resolveInheritedConversationSettings({
      ...resources.options,
      role,
      ...(role === "lead"
        ? {
            user: values.find((value) => value.scope.scope === "user")?.document
              .overrides,
            project: trustedProject ? project.document.overrides : undefined,
          }
        : {}),
      appliedProfile: document.appliedProfile,
      ...("frozenDefaults" in document
        ? { frozenDefaults: document.frozenDefaults }
        : {}),
    });
  }
  return resolveAgentConfiguration({
    ...resources.options,
    process: undefined,
    role: "lead",
    ...(scope.scope === "project"
      ? {
          user: values.find((value) => value.scope.scope === "user")?.document
            .overrides,
        }
      : {}),
  }).settings;
}

export function normalizeAgentDocument(
  port: Pick<TransactionPort, "options">,
  scope: AgentScope,
  document: AgentDocument,
  values: readonly ScopeGeneration<AgentScope, AgentDocument>[],
  resources: ResourceSnapshot,
): AgentDocument {
  if (
    scope.scope === "conversation" &&
    port.options.conversationOwner(scope.conversationId).role === "child"
  )
    return document;
  return {
    ...document,
    overrides: normalizeSettingsOverrides(
      document.overrides,
      inheritedAgentSettings(port, scope, document, values, resources),
    ),
  };
}

export function validateAgentResolution(
  resolution: ResolutionResult,
  resources: ResourceSnapshot,
): void {
  // The resolver distinguishes invalid same-layer/required pairs from valid
  // cross-layer fitting; rechecking the raw choice would reject D7 adjustments.
  if (
    resolution.diagnostics.some(
      (issue) => issue.code === "unsupported-reasoning",
    )
  )
    throw new Error("Unsupported explicit model/reasoning combination");
  if (!resources.isCurrent())
    throw new Error("Configuration dependencies changed; retry save");
}

export async function resolveRepairCandidate(
  port: TransactionPort & { paths: AgentConfigurationPaths },
  scope: AgentScope,
  input: unknown,
): Promise<ResolutionResult> {
  const candidate = input as AgentDocument;
  const projectId =
    scope.scope === "project"
      ? scope.projectId
      : scope.scope === "conversation"
        ? port.options.conversationOwner(scope.conversationId).projectId
        : undefined;
  if (projectId) await port.options.prepareResources?.(projectId);
  const resources = await port.captureResources(
    projectId,
    scope.scope === "conversation"
      ? port.options.conversationOwner(scope.conversationId).role
      : "lead",
  );
  const scopes: AgentScope[] =
    scope.scope === "conversation"
      ? port.dependencies(scope.conversationId)
      : scope.scope === "project"
        ? [{ scope: "user" }, scope]
        : [scope];
  const values: ScopeGeneration<AgentScope, AgentDocument>[] = [];
  for (const dependency of scopes) {
    if (JSON.stringify(dependency) === JSON.stringify(scope))
      values.push({
        scope,
        path: port.paths.agent(scope),
        revision: candidate.revision,
        generation: 0,
        digest: digestBytes(`${JSON.stringify(candidate, null, 2)}\n`),
        document: candidate,
      });
    else {
      const state = await port.load(dependency);
      if (isUntrustedAgentDocument(port.options, port.paths, state)) continue;
      if (state.status === "unavailable") throw new ScopeUnavailableError();
      values.push(state.value);
    }
  }
  const resolution =
    scope.scope === "conversation"
      ? port.resolve(scope.conversationId, values, resources, candidate)
      : resolveAgentConfiguration({
          ...resources.options,
          role: "lead",
          user: values.find((v) => v.scope.scope === "user")?.document
            .overrides,
          project: values.find((v) => v.scope.scope === "project")?.document
            .overrides,
        });
  if (
    resolution.diagnostics.some(
      (issue) => issue.code === "unsupported-reasoning",
    )
  )
    throw new Error("Unsupported model/reasoning combination");
  if (!resources.isCurrent())
    throw new Error("Configuration dependencies changed; retry repair preview");
  // New project bytes are not implicitly trusted by repair consent. Validate
  // their proposed pair above, but show the actually applicable post-repair view.
  if (
    scope.scope === "project" &&
    port.options.isProjectAgentTrusted &&
    !port.options.isProjectAgentTrusted(
      scope.projectId,
      port.paths.agent(scope),
      digestBytes(`${JSON.stringify(candidate, null, 2)}\n`),
    )
  ) {
    return resolveAgentConfiguration({
      ...resources.options,
      role: "lead",
      user: values.find((v) => v.scope.scope === "user")?.document.overrides,
    });
  }
  return resolution;
}

export function resolveStoredAgent(
  options: AgentConfigurationServiceOptions,
  id: string,
  values: readonly ScopeGeneration<AgentScope, AgentDocument>[],
  resources: ResourceSnapshot,
  candidate?: AgentDocument,
): ResolutionResult {
  const role = options.conversationOwner(id).role;
  const conversation =
    candidate ??
    values.find((value) => value.scope.scope === "conversation")?.document;
  if (!conversation || !("appliedProfile" in conversation))
    throw new ScopeUnavailableError();
  return resolveAgentConfiguration({
    ...resources.options,
    role,
    ...(role === "lead"
      ? {
          user: values.find((value) => value.scope.scope === "user")?.document
            .overrides,
          project: values.find((value) => value.scope.scope === "project")
            ?.document.overrides,
        }
      : {}),
    conversation: conversation.overrides,
    appliedProfile: conversation.appliedProfile,
    ...("frozenDefaults" in conversation
      ? { frozenDefaults: conversation.frozenDefaults }
      : {}),
  });
}

export function prepareCreationMutation(mutation: {
  expectedRevision: number;
  expectedDigest: string;
  changes: CreationPreferences["overrides"];
  resets: string[];
}) {
  if (
    Object.keys(mutation).some(
      (key) =>
        !["expectedRevision", "expectedDigest", "changes", "resets"].includes(
          key,
        ),
    )
  )
    throw new Error("Unknown creation mutation property");
  const expected = agentMutationSchema.parse({
    expectedRevision: mutation.expectedRevision,
    expectedDigest: mutation.expectedDigest,
    changes: {},
    resets: [],
  });
  const changes = conversationDefaultsSchema.shape.overrides.parse(
    mutation.changes,
  );
  const keys = mutation.resets.map((pointer) => {
    if (
      pointer !== "/overrides/defaultAgentProfile" &&
      pointer !== "/overrides/scopedModels"
    )
      throw new Error("Unsupported creation preference reset");
    return pointer.slice(11) as keyof CreationPreferences["overrides"];
  });
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => Object.hasOwn(changes, key))
  )
    throw new Error("Overlapping creation mutations");
  return { expected, changes, keys };
}

export async function prepareConversationDocument(
  port: TransactionPort,
  conversationId: string,
  input: unknown,
) {
  const owner = port.options.conversationOwner(conversationId);
  await port.options.prepareResources?.(owner.projectId);
  let document: AgentDocument = (
    owner.role === "child"
      ? childConversationAgentSchema
      : leadConversationAgentSchema
  ).parse(input);
  if (owner.role === "child" && Object.keys(document.overrides).length)
    throw new Error("New child overrides must be empty");
  const scopes = port
    .dependencies(conversationId)
    .filter((scope) => scope.scope !== "conversation");
  await Promise.all(scopes.map((scope) => port.load(scope)));
  const values = scopes
    .map((scope) => port.store.peek(scope))
    .flatMap((state) => {
      if (!state || state.status === "unavailable")
        throw new ScopeUnavailableError();
      return [state.value];
    });
  const resources = await port.captureResources(owner.projectId, owner.role);
  document = normalizeAgentDocument(
    port,
    { scope: "conversation", conversationId },
    document,
    values,
    resources,
  );
  validateAgentResolution(
    port.resolve(conversationId, values, resources, document),
    resources,
  );
  return document;
}

export function isUntrustedAgentDocument(
  options: AgentConfigurationServiceOptions,
  paths: AgentConfigurationPaths,
  state: ScopeHealth<AgentScope, AgentDocument>,
): boolean {
  const scope =
    state.status === "unavailable" ? state.scope : state.value.scope;
  const digest =
    state.status === "unavailable" ? state.sourceDigest : state.value.digest;
  return (
    scope.scope === "project" &&
    digest !== undefined &&
    digest !== "missing" &&
    options.isProjectAgentTrusted !== undefined &&
    !options.isProjectAgentTrusted(scope.projectId, paths.agent(scope), digest)
  );
}
