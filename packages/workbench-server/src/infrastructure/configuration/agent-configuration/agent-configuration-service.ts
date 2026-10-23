import {
  agentPreferencesSchema,
  agentMutationSchema,
  applySettingsMutation,
  leadConversationAgentSchema,
  childConversationAgentSchema,
  conversationDefaultsSchema,
  conversationAgentSummariesSchema,
  resolveAgentConfiguration,
  type ResolutionOptions,
  type ResolutionResult,
  type AppliedProfile,
  type ImplementationChoices,
  type ConfigurationVersion,
} from "@nervekit/contracts/agent-configuration";
import type { z } from "zod";
import {
  ScopedDocumentStore,
  ScopeUnavailableError,
  freezeJson,
  type ScopedDocumentOptions,
  type ScopeGeneration,
} from "../scoped-store/scoped-document-store.js";
import { ConversationSummaryCache } from "../scoped-store/conversation-summary-cache.js";
import {
  AgentConfigurationPaths,
  healthDiagnostics,
  diagnostic,
  parserIssues,
  type AgentScope,
  type PreferenceScope,
  type AgentDocument,
  type CreationPreferences,
  type ConfigurationDiagnostic,
  type ConfigurationLocations,
} from "./document-adapters.js";
import { AgentProfileCatalog } from "./profile-catalog.js";

export interface ResourceSnapshot {
  options: Pick<
    ResolutionOptions,
    "process" | "eligibleSkills" | "clampThinking" | "referenceAvailable"
  >;
  /** Includes model/account/trust/discovery generations; synchronous, never polls files. */
  isCurrent(): boolean;
}
export interface AgentConfigurationServiceOptions extends ConfigurationLocations {
  builtins: Readonly<Record<string, string>>;
  isProfileTrusted(projectId: string, path: string, digest: string): boolean;
  prepareResources?(projectId: string): Promise<void>;
  captureResources(projectId?: string): ResourceSnapshot;
  /** Receipt-bearing documents may only mutate after the lifecycle owner verifies reconciliation. */
  transitionReconciled?(
    conversationId: string,
    receipt: NonNullable<
      Extract<AgentDocument, { appliedProfile: unknown }>["lastTransition"]
    >,
  ): boolean;
  publish?(
    domain: "agent" | "conversation-defaults" | "profile",
    scope: AgentScope,
  ): void;
  io?: Pick<
    ScopedDocumentOptions<AgentScope, AgentDocument>,
    "write" | "syncDirectory"
  >;
}
export type EffectiveAgentView =
  | {
      readonly status: "available";
      readonly conversationId: string;
      readonly role: "lead" | "child";
      readonly resolution: ResolutionResult;
      readonly diagnostics: readonly ConfigurationDiagnostic[];
      readonly sources: readonly ScopeGeneration<AgentScope, AgentDocument>[];
    }
  | {
      readonly status: "unavailable";
      readonly conversationId: string;
      readonly diagnostics: readonly ConfigurationDiagnostic[];
    };
type Summary = z.infer<
  typeof conversationAgentSummariesSchema
>["entries"][string];
type CreationMutation = {
  expectedRevision: number;
  expectedDigest: string;
  changes: CreationPreferences["overrides"];
  resets: string[];
};

/** Unwired domain service. Does not perform execution admission or load mutable profile definitions for applied snapshots. */
export class AgentConfigurationService {
  readonly paths: AgentConfigurationPaths;
  readonly profiles: AgentProfileCatalog;
  private readonly agents: ScopedDocumentStore<AgentScope, AgentDocument>;
  private readonly creation: ScopedDocumentStore<
    PreferenceScope,
    CreationPreferences
  >;
  private readonly summaries: ConversationSummaryCache<Summary>;
  private readonly agentScopes = new Map<string, AgentScope>();
  private readonly creationScopes = new Map<string, PreferenceScope>();
  private readonly effective = new Map<
    string,
    { view: EffectiveAgentView; current: () => boolean }
  >();
  private readonly creationListeners = new Set<
    (scope: PreferenceScope) => void
  >();
  subscribeCreation(listener: (scope: PreferenceScope) => void): () => void {
    this.creationListeners.add(listener);
    return () => this.creationListeners.delete(listener);
  }
  private notifyCreation(scope: PreferenceScope): void {
    for (const listener of this.creationListeners) {
      try {
        listener(scope);
      } catch {
        /* Recoverable notifications. */
      }
    }
  }
  private readonly healthListeners = new Set<(scope: AgentScope) => void>();
  subscribeHealth(listener: (scope: AgentScope) => void): () => void {
    this.healthListeners.add(listener);
    return () => this.healthListeners.delete(listener);
  }
  private notifyHealth(scope: AgentScope): void {
    for (const listener of this.healthListeners) {
      try {
        listener(scope);
      } catch {
        /* Observers never roll back configuration authority. */
      }
    }
  }
  private readonly creatingConversations = new Set<string>();
  private readonly publicationGuards = new Map<string, () => boolean>();
  private resourceEpoch = 0;
  private catalogEpoch = 0;
  private readonly projections = new Set<Promise<unknown>>();
  private readonly forgotten = new Set<string>();

  constructor(private readonly options: AgentConfigurationServiceOptions) {
    this.paths = new AgentConfigurationPaths(options);
    this.agents = new ScopedDocumentStore({
      ...options.io,
      resolvePath: (scope) => this.paths.agent(scope),
      required: (scope) => scope.scope === "conversation",
      supportedVersion: 1,
      empty: () => ({ schemaVersion: 1, revision: 0, overrides: {} }),
      parse: (input, scope) =>
        scope.scope === "conversation"
          ? (options.conversationOwner(scope.conversationId).role === "child"
              ? childConversationAgentSchema
              : leadConversationAgentSchema
            ).parse(input)
          : agentPreferencesSchema.parse(input),
      issues: parserIssues,
      publish: (value) => {
        if (
          value.scope.scope === "conversation" &&
          this.publicationGuards.get(value.scope.conversationId)?.() === false
        )
          throw new Error(
            "Conversation dependencies changed before publication",
          );
        options.publish?.("agent", value.scope);
      },
    });
    this.creation = new ScopedDocumentStore({
      ...options.io,
      resolvePath: (scope) => this.paths.creation(scope),
      required: () => false,
      supportedVersion: 1,
      empty: () => ({ schemaVersion: 1, revision: 0, overrides: {} }),
      parse: (input) => conversationDefaultsSchema.parse(input),
      issues: parserIssues,
      publish: (value) =>
        options.publish?.("conversation-defaults", value.scope),
    });
    this.profiles = new AgentProfileCatalog({
      paths: this.paths,
      builtins: options.builtins,
      isTrusted: options.isProfileTrusted,
      io: options.io,
      publish: (scope) => options.publish?.("profile", scope),
      invalidate: (scope) => {
        this.catalogEpoch += 1;
        this.notifyHealth(scope);
      },
    });
    this.summaries = new ConversationSummaryCache({
      path: this.paths.summaries,
      parse: (input) => conversationAgentSummariesSchema.parse(input),
    });
  }

  async initialize(): Promise<{ diagnostics: ConfigurationDiagnostic[] }> {
    await Promise.all([
      this.ensureLoaded({ scope: "user" }),
      this.loadCreation({ scope: "user" }),
      this.profiles.list(),
      this.summaries.load(),
    ]);
    return { diagnostics: this.health() };
  }

  ensureLoaded(scope: AgentScope) {
    this.track(scope);
    return this.agents.ensureLoaded(scope);
  }
  async reload(scope: AgentScope) {
    this.track(scope);
    const result = await this.agents.reload(scope);
    this.notifyHealth(scope);
    return result;
  }
  private track(scope: AgentScope): void {
    const key = this.paths.agent(scope);
    if (this.agentScopes.has(key)) return;
    this.agentScopes.set(key, structuredClone(scope));
    this.agents.onInvalidate(scope, () => {
      for (const [id] of this.effective) {
        const owner = this.options.conversationOwner(id);
        if (
          (scope.scope === "conversation" && scope.conversationId === id) ||
          (owner.role === "lead" &&
            (scope.scope === "user" ||
              (scope.scope === "project" &&
                scope.projectId === owner.projectId)))
        )
          this.effective.delete(id);
      }
    });
  }

  invalidateResources(): void {
    this.resourceEpoch += 1;
    this.effective.clear();
  }
  forgetConversation(id: string): void {
    this.forgotten.add(id);
    this.effective.delete(id);
    for (const [key, scope] of this.agentScopes) {
      if (scope.scope === "conversation" && scope.conversationId === id)
        this.agentScopes.delete(key);
    }
    this.summaries.remove(id);
    this.project(() => this.summaries.flush());
  }

  private dependencies(id: string): AgentScope[] {
    const owner = this.options.conversationOwner(id);
    return owner.role === "child"
      ? [{ scope: "conversation", conversationId: id }]
      : [
          { scope: "user" },
          { scope: "project", projectId: owner.projectId },
          { scope: "conversation", conversationId: id },
        ];
  }

  async getEffective(conversationId: string): Promise<EffectiveAgentView> {
    const owner = this.options.conversationOwner(conversationId);
    const projectId = owner.projectId;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const initialResources = this.options.captureResources(projectId);
      await this.options.prepareResources?.(projectId);
      const cached = this.effective.get(conversationId);
      if (cached?.current()) return cached.view;
      const scopes = this.dependencies(conversationId);
      await Promise.all(scopes.map((scope) => this.ensureLoaded(scope)));
      if (!initialResources.isCurrent()) continue;
      const states = scopes.map((scope) => this.agents.peek(scope)!);
      const diagnostics = states.flatMap((state) =>
        healthDiagnostics(state, "agent"),
      );
      if (states.some((state) => state.status === "unavailable"))
        return freezeJson({
          status: "unavailable",
          conversationId,
          diagnostics,
        });
      const values = states.flatMap((state) =>
        state.status === "unavailable" ? [] : [state.value],
      );
      const checkDocuments = this.agents.captureGenerations(scopes);
      const resourceEpoch = this.resourceEpoch;
      const catalogEpoch = this.catalogEpoch;
      const resources = this.options.captureResources(projectId);
      const resolution = this.resolve(conversationId, values, resources);
      const current = () =>
        checkDocuments() &&
        resourceEpoch === this.resourceEpoch &&
        (owner.role === "child" || catalogEpoch === this.catalogEpoch) &&
        resources.isCurrent();
      if (!current()) continue;
      for (const issue of resolution.diagnostics) {
        const provenance = resolution.provenance[issue.pointer]?.source;
        const scope = scopes.find((s) => s.scope === provenance) ?? {
          scope: "conversation" as const,
          conversationId,
        };
        diagnostics.push(
          diagnostic(
            scope,
            "agent",
            this.paths.agent(scope),
            issue.code,
            issue.pointer,
            1,
          ),
        );
      }
      const view: EffectiveAgentView = freezeJson({
        status: "available",
        conversationId,
        role: owner.role,
        resolution,
        diagnostics,
        sources: values,
      });
      this.effective.set(conversationId, { view, current });
      this.updateSummary(conversationId, view);
      return view;
    }
    return {
      status: "unavailable",
      conversationId,
      diagnostics: [
        diagnostic(
          { scope: "conversation", conversationId },
          "agent",
          this.paths.agent({ scope: "conversation", conversationId }),
          "dependencies-changing",
        ),
      ],
    };
  }

  /** New-conversation/launch resolution from defaults only: never reads a parent's choices. */
  async captureDefaults(projectId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const initialResources = this.options.captureResources(projectId);
      await this.options.prepareResources?.(projectId);
      const scopes: AgentScope[] = [
        { scope: "user" },
        { scope: "project", projectId },
      ];
      await Promise.all(scopes.map((scope) => this.ensureLoaded(scope)));
      if (!initialResources.isCurrent()) continue;
      const values = scopes.map((scope) => {
        const state = this.agents.peek(scope)!;
        if (state.status === "unavailable") throw new ScopeUnavailableError();
        return state.value.document.overrides;
      });
      const resources = this.options.captureResources(projectId);
      const documentsCurrent = this.agents.captureGenerations(scopes);
      const epoch = this.resourceEpoch;
      const catalog = this.catalogEpoch;
      return {
        options: { ...resources.options, user: values[0], project: values[1] },
        isCurrent: () =>
          documentsCurrent() &&
          resources.isCurrent() &&
          epoch === this.resourceEpoch &&
          catalog === this.catalogEpoch,
      };
    }
    throw new ScopeUnavailableError();
  }

  async captureEffective(
    conversationId: string,
  ): Promise<{ view: EffectiveAgentView; isCurrent: () => boolean }> {
    const view = await this.getEffective(conversationId);
    const cached = this.effective.get(conversationId);
    return {
      view,
      isCurrent: () =>
        !this.forgotten.has(conversationId) &&
        cached?.view === view &&
        this.effective.get(conversationId) === cached &&
        cached.current(),
    };
  }

  private resolve(
    id: string,
    values: readonly ScopeGeneration<AgentScope, AgentDocument>[],
    resources: ResourceSnapshot,
    candidate?: AgentDocument,
  ): ResolutionResult {
    const role = this.options.conversationOwner(id).role;
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

  async save(scope: AgentScope, input: unknown) {
    const mutation = agentMutationSchema.parse(input);
    if (
      scope.scope === "conversation" &&
      this.options.conversationOwner(scope.conversationId).role === "child"
    )
      throw new Error("Child preference editing is not supported");
    const dependencies: AgentScope[] =
      scope.scope === "conversation"
        ? this.dependencies(scope.conversationId)
        : scope.scope === "project"
          ? [{ scope: "user" }, scope]
          : [scope];
    await Promise.all(
      dependencies.map((dependency) => this.ensureLoaded(dependency)),
    );
    const result = await this.agents.save(
      scope,
      { revision: mutation.expectedRevision, digest: mutation.expectedDigest },
      (document) => {
        if (
          scope.scope === "conversation" &&
          "lastTransition" in document &&
          document.lastTransition &&
          !this.options.transitionReconciled?.(
            scope.conversationId,
            document.lastTransition,
          )
        )
          throw new Error(
            "Committed transition must be reconciled before mutation",
          );
        const requirements =
          "appliedProfile" in document
            ? document.appliedProfile?.requirements
            : undefined;
        const candidate = {
          ...document,
          overrides: applySettingsMutation(
            document.overrides,
            mutation,
            requirements,
          ),
        };
        const resources = this.options.captureResources(
          scope.scope === "project"
            ? scope.projectId
            : scope.scope === "conversation"
              ? this.options.conversationOwner(scope.conversationId).projectId
              : undefined,
        );
        const values = dependencies
          .map((dependency) => this.agents.peek(dependency))
          .flatMap((state) => {
            if (!state || state.status === "unavailable")
              throw new ScopeUnavailableError();
            return [state.value];
          });
        const resolution =
          scope.scope === "conversation"
            ? this.resolve(scope.conversationId, values, resources, candidate)
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
        this.validateSave(candidate, resolution, resources);
        return candidate;
      },
    );
    if (scope.scope === "conversation")
      this.project(() => this.refreshSummary(scope.conversationId));
    else
      this.project(async () => {
        for (const loaded of this.agentScopes.values()) {
          if (
            loaded.scope !== "conversation" ||
            this.forgotten.has(loaded.conversationId)
          )
            continue;
          try {
            const owner = this.options.conversationOwner(loaded.conversationId);
            if (
              owner.role === "lead" &&
              (scope.scope === "user" || scope.projectId === owner.projectId)
            )
              await this.refreshSummary(loaded.conversationId);
          } catch {
            /* A deleted identity cannot turn projection work into a failed configuration save. */
          }
        }
      });
    this.notifyHealth(scope);
    return result;
  }

  /** Trusted profile lifecycle commit; the caller journals its decision before invoking this. */
  async commitProfile(
    id: string,
    expected: ConfigurationVersion,
    appliedProfile: AppliedProfile,
    choices: ImplementationChoices,
    receipt: { id: string; kind: "profile" | "plan-approval" },
    isCurrent: () => boolean,
  ) {
    if (this.options.conversationOwner(id).role !== "lead")
      throw new Error("Child profile transitions are unsupported");
    const scope = { scope: "conversation" as const, conversationId: id };
    await this.ensureLoaded(scope);
    try {
      const result = await this.agents.save(scope, expected, (document) => {
        if (!("appliedProfile" in document)) throw new ScopeUnavailableError();
        if (
          document.lastTransition &&
          !this.options.transitionReconciled?.(id, document.lastTransition)
        )
          throw new Error(
            "Committed transition must be reconciled before mutation",
          );
        if (!isCurrent()) throw new Error("Transition dependencies changed");
        this.publicationGuards.set(id, isCurrent);
        return {
          ...document,
          overrides: { ...document.overrides, ...choices },
          appliedProfile,
          lastTransition: receipt,
        };
      });
      this.notifyHealth(scope);
      this.project(() => this.refreshSummary(id));
      return result.value;
    } finally {
      if (this.publicationGuards.get(id) === isCurrent)
        this.publicationGuards.delete(id);
    }
  }

  private validateSave(
    candidate: AgentDocument,
    resolution: ResolutionResult,
    resources: ResourceSnapshot,
  ): void {
    const reasoning =
      resolution.provenance["/reasoningLevel"]?.source === "requirement"
        ? undefined
        : candidate.overrides.reasoningLevel;
    if (
      resolution.diagnostics.some(
        (issue) => issue.code === "unsupported-reasoning",
      ) ||
      (resolution.settings.model &&
        reasoning &&
        resources.options.clampThinking &&
        resources.options.clampThinking(
          resolution.settings.model,
          reasoning,
        ) !== reasoning)
    )
      throw new Error("Unsupported explicit model/reasoning combination");
    if (!resources.isCurrent())
      throw new Error("Configuration dependencies changed; retry save");
  }

  /** Trusted host-only initial creation; not a repair or arbitrary UI document editor. */
  async createConversation(
    conversationId: string,
    input: unknown,
    isCurrent: () => boolean = () => true,
  ) {
    if (this.forgotten.has(conversationId))
      throw new Error(
        "Deleted conversation identities cannot be reused in this runtime",
      );
    if (this.creatingConversations.has(conversationId))
      throw new Error(
        "Conversation configuration creation is already in progress",
      );
    this.creatingConversations.add(conversationId);
    try {
      const owner = this.options.conversationOwner(conversationId);
      await this.options.prepareResources?.(owner.projectId);
      const document = (
        owner.role === "child"
          ? childConversationAgentSchema
          : leadConversationAgentSchema
      ).parse(input);
      if (owner.role === "child" && Object.keys(document.overrides).length)
        throw new Error("New child overrides must be empty");
      const scopes = this.dependencies(conversationId).filter(
        (scope) => scope.scope !== "conversation",
      );
      await Promise.all(scopes.map((scope) => this.ensureLoaded(scope)));
      const values = scopes
        .map((scope) => this.agents.peek(scope))
        .flatMap((state) => {
          if (!state || state.status === "unavailable")
            throw new ScopeUnavailableError();
          return [state.value];
        });
      const resources = this.options.captureResources(owner.projectId);
      this.validateSave(
        document,
        this.resolve(conversationId, values, resources, document),
        resources,
      );
      const scope = { scope: "conversation" as const, conversationId };
      this.track(scope);
      if (!isCurrent())
        throw new Error("Creation dependencies changed; retry launch");
      this.publicationGuards.set(conversationId, isCurrent);
      try {
        const result = await this.agents.create(scope, document);
        this.notifyHealth(scope);
        this.project(() => this.refreshSummary(conversationId));
        return result;
      } finally {
        this.publicationGuards.delete(conversationId);
      }
    } finally {
      this.creatingConversations.delete(conversationId);
    }
  }

  loadCreation(scope: PreferenceScope) {
    this.creationScopes.set(this.paths.creation(scope), structuredClone(scope));
    return this.creation.ensureLoaded(scope);
  }
  reloadCreation(scope: PreferenceScope) {
    this.creationScopes.set(this.paths.creation(scope), structuredClone(scope));
    return this.creation.reload(scope);
  }
  async getCreationPreferences(projectId?: string) {
    const scopes: PreferenceScope[] = projectId
      ? [{ scope: "user" }, { scope: "project", projectId }]
      : [{ scope: "user" }];
    await Promise.all(scopes.map((scope) => this.loadCreation(scope)));
    const user = this.creation.peek(scopes[0])!;
    const project = scopes[1] ? this.creation.peek(scopes[1]) : undefined;
    const diagnostics = [user, ...(project ? [project] : [])].flatMap((state) =>
      healthDiagnostics(state, "conversation-defaults"),
    );
    if (user.status === "unavailable" || project?.status === "unavailable")
      return { status: "unavailable" as const, diagnostics };
    return freezeJson({
      status: "available" as const,
      overrides: {
        defaultAgentProfile: "coding",
        ...user.value.document.overrides,
        ...project?.value.document.overrides,
      },
      diagnostics,
    });
  }
  async saveCreation(scope: PreferenceScope, mutation: CreationMutation) {
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
    await this.loadCreation(scope);
    return this.creation.save(
      scope,
      { revision: expected.expectedRevision, digest: expected.expectedDigest },
      (document) => {
        const overrides = { ...document.overrides, ...changes };
        for (const key of keys) delete overrides[key];
        return { ...document, overrides };
      },
    );
  }

  health(): ConfigurationDiagnostic[] {
    return [
      ...[...this.agentScopes.values()].flatMap((scope) => {
        const state = this.agents.peek(scope);
        return state ? healthDiagnostics(state, "agent") : [];
      }),
      ...[...this.creationScopes.values()].flatMap((scope) => {
        const state = this.creation.peek(scope);
        return state ? healthDiagnostics(state, "conversation-defaults") : [];
      }),
      ...this.profiles.health(),
    ];
  }
  getSummary(conversationId: string): Readonly<Summary> | undefined {
    return this.summaries.get(conversationId);
  }
  async flushSummaries(): Promise<boolean> {
    while (this.projections.size) await Promise.all([...this.projections]);
    return this.summaries.flush();
  }
  private project(work: () => Promise<unknown>): void {
    const pending = Promise.resolve()
      .then(work)
      .catch(() => undefined)
      .finally(() => {
        this.projections.delete(pending);
      });
    this.projections.add(pending);
  }
  private async refreshSummary(id: string): Promise<void> {
    try {
      await this.getEffective(id);
    } catch {
      /* Display cache work never fails an acknowledged save. */
    }
  }
  private updateSummary(
    id: string,
    view: Extract<EffectiveAgentView, { status: "available" }>,
  ): void {
    if (this.forgotten.has(id)) return;
    if (
      view.resolution.diagnostics.some(
        (issue) => issue.code !== "reasoning-adjusted",
      )
    ) {
      this.summaries.remove(id);
      this.project(() => this.summaries.flush());
      return;
    }
    const settings = view.resolution.settings;
    const conversation = view.sources.find(
      (source) => source.scope.scope === "conversation",
    );
    if (!conversation || !("appliedProfile" in conversation.document)) return;
    try {
      this.summaries.set(id, {
        observedDigest: conversation.digest,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.reasoningLevel
          ? { reasoningLevel: settings.reasoningLevel }
          : {}),
        ...(settings.permissionRuleSetId
          ? { permissionRuleSetId: settings.permissionRuleSetId }
          : {}),
        ...(conversation.document.appliedProfile
          ? { agentProfile: conversation.document.appliedProfile.name }
          : {}),
      });
      this.project(() => this.summaries.flush());
    } catch {
      /* Disposable cache failure is not configuration publication failure. */
    }
  }
}
