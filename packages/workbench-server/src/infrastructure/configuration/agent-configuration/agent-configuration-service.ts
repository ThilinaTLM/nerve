import { ProjectAgentDefaults } from "./project-agent-defaults.js";
import { withoutLegacyTransition } from "./document-adapters.js";
import {
  readCreationPreferences,
  readInheritedCreationPreferences,
  saveCreationPreferences,
  type CreationMutation,
} from "./creation-preferences.js";
import { upgradeBlock, legacyRepairFile } from "./scoped-upgrade-health.js";
import { conversationSummary } from "./conversation-summary.js";
import {
  loadConversationContext,
  readConversationContext,
  saveConversationContext,
} from "./conversation-context.js";
import {
  saveAgentDocument,
  readInheritedAgentSettings,
  isUntrustedAgentDocument,
  prepareConversationDocument,
  resolveRepairCandidate,
  resolveStoredAgent,
  type TransactionPort,
} from "./agent-document-transactions.js";
import {
  agentPreferencesSchema,
  leadConversationAgentSchema,
  childConversationAgentSchema,
  conversationDefaultsSchema,
  conversationAgentSummariesSchema,
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
  type ScopeHealth,
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
  prepareUser?(): Promise<void>;
  retryUserMigration?(): void;
  prepareProject?(projectId: string): Promise<void>;
  retryProjectMigration?(projectId: string): void;
  isProjectAgentTrusted?(
    projectId: string,
    path: string,
    digest: string,
  ): boolean;
  isProfileTrusted(projectId: string, path: string, digest: string): boolean;
  prepareResources?(projectId: string): Promise<void>;
  captureResources(projectId?: string): ResourceSnapshot;
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
/** Scoped configuration authority. Does not perform execution admission or load mutable profile definitions for applied snapshots. */
export class AgentConfigurationService {
  readonly paths: AgentConfigurationPaths;
  readonly profiles: AgentProfileCatalog;
  readonly projectDefaults = new ProjectAgentDefaults(this);
  private readonly agents: ScopedDocumentStore<AgentScope, AgentDocument>;
  private readonly creation: ScopedDocumentStore<
    PreferenceScope,
    CreationPreferences
  >;
  private readonly summaryListeners = new Set<(id: string) => void>();
  subscribeSummary(listener: (id: string) => void): () => void {
    this.summaryListeners.add(listener);
    return () => this.summaryListeners.delete(listener);
  }
  private notifySummary(id: string): void {
    for (const listener of this.summaryListeners) {
      try {
        listener(id);
      } catch {
        /* Disposable display observers. */
      }
    }
  }
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
      prepareProject: (id) => this.prepareProject(id),
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

  private retryScope(scope: AgentScope): void {
    const preference = this.paths.preferenceScope(scope);
    if (preference.scope === "user") this.options.retryUserMigration?.();
    else this.options.retryProjectMigration?.(preference.projectId);
    this.invalidateResources();
  }
  legacyRepairFile(scope: AgentScope) {
    return legacyRepairFile(this.agents.peek(scope));
  }
  async ensureLoaded(scope: AgentScope) {
    const blocked = await this.prepareScope(this.paths.preferenceScope(scope));
    if (blocked) return blocked;
    this.track(scope);
    return this.agents.ensureLoaded(scope);
  }
  async reload(scope: AgentScope) {
    this.retryScope(scope);
    const blocked = await this.prepareScope(this.paths.preferenceScope(scope));
    if (blocked) return blocked;
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
      this.notifyHealth(scope);
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
    const projectIdForMigration =
      this.options.conversationOwner(conversationId).projectId;
    try {
      await this.prepareProject(projectIdForMigration);
    } catch {
      return {
        status: "unavailable",
        conversationId,
        diagnostics: healthDiagnostics(
          this.agents.peek({
            scope: "project",
            projectId: projectIdForMigration,
          })!,
          "agent",
        ),
      };
    }
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
      if (
        states.some(
          (state) =>
            state.status === "unavailable" && !this.untrustedProject(state),
        )
      )
        return freezeJson({
          status: "unavailable",
          conversationId,
          diagnostics,
        });
      const values = states.flatMap((state) => {
        if (this.untrustedProject(state)) {
          const scope =
            state.status === "unavailable" ? state.scope : state.value.scope;
          diagnostics.push(
            diagnostic(
              scope,
              "agent",
              this.paths.agent(scope),
              "untrusted-project",
            ),
          );
          return [
            {
              scope,
              path: this.paths.agent(scope),
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
        return state.status === "unavailable" ? [] : [state.value];
      });
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
        if (this.untrustedProject(state)) return {};
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

  private untrustedProject(
    state: ScopeHealth<AgentScope, AgentDocument>,
  ): boolean {
    return isUntrustedAgentDocument(this.options, this.paths, state);
  }
  private resolve(
    id: string,
    values: readonly ScopeGeneration<AgentScope, AgentDocument>[],
    resources: ResourceSnapshot,
    candidate?: AgentDocument,
  ): ResolutionResult {
    return resolveStoredAgent(this.options, id, values, resources, candidate);
  }

  async loadConversationContext(id: string) {
    this.track({ scope: "conversation", conversationId: id });
    return loadConversationContext(this.agents, id);
  }
  getConversationContext(id: string) {
    return readConversationContext(this.agents, id);
  }
  async configureContext(id: string, input: unknown): Promise<void> {
    const scope = { scope: "conversation" as const, conversationId: id };
    this.track(scope);
    await saveConversationContext(this.agents, id, input);
    this.notifyHealth(scope);
  }

  private transactionPort(): TransactionPort & {
    paths: AgentConfigurationPaths;
  } {
    return {
      store: this.agents,
      options: this.options,
      paths: this.paths,
      load: (scope) => this.ensureLoaded(scope),
      dependencies: (id) => this.dependencies(id),
      resolve: (id, values, resources, candidate) =>
        this.resolve(id, values, resources, candidate),
    };
  }

  getInheritedSettings(scope: AgentScope) {
    return readInheritedAgentSettings(this.transactionPort(), scope);
  }

  async getInheritedCreationPreferences(scope: PreferenceScope) {
    return readInheritedCreationPreferences(
      this.creation,
      (dependency) => this.loadCreation(dependency),
      scope,
    );
  }

  async save(scope: AgentScope, input: unknown) {
    const result = await saveAgentDocument(
      this.transactionPort(),
      scope,
      input,
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

  /** Trusted profile CAS commit, with snapshot and choices in one file generation. */
  async commitProfile(
    id: string,
    expected: ConfigurationVersion,
    appliedProfile: AppliedProfile,
    choices: ImplementationChoices,
    isCurrent: () => boolean,
  ) {
    if (this.options.conversationOwner(id).role !== "lead")
      throw new Error("Child profile transitions are unsupported");
    const scope = { scope: "conversation" as const, conversationId: id };
    await this.ensureLoaded(scope);
    try {
      const result = await this.agents.save(
        scope,
        expected,
        async (document) => {
          if (!("appliedProfile" in document))
            throw new ScopeUnavailableError();
          if (!isCurrent()) throw new Error("Transition dependencies changed");
          this.publicationGuards.set(id, isCurrent);
          return prepareConversationDocument(this.transactionPort(), id, {
            ...withoutLegacyTransition(document),
            overrides: { ...document.overrides, ...choices },
            appliedProfile,
          });
        },
      );
      this.notifyHealth(scope);
      this.project(() => this.refreshSummary(id));
      return result.value;
    } finally {
      if (this.publicationGuards.get(id) === isCurrent)
        this.publicationGuards.delete(id);
    }
  }

  repairResolution(
    scope: AgentScope,
    input: unknown,
  ): Promise<ResolutionResult> {
    return resolveRepairCandidate(this.transactionPort(), scope, input);
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
      const document = await prepareConversationDocument(
        this.transactionPort(),
        conversationId,
        input,
      );
      const scope = { scope: "conversation" as const, conversationId };
      this.track(scope);
      if (!isCurrent())
        throw new Error("Creation dependencies changed; retry launch");
      this.publicationGuards.set(conversationId, isCurrent);
      try {
        const result = await this.agents.create(
          scope,
          withoutLegacyTransition(document),
        );
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

  async loadCreation(scope: PreferenceScope) {
    const blocked = await this.prepareScope(scope);
    if (blocked?.status === "unavailable")
      return this.creation.block(scope, {
        path: blocked.path,
        digest: blocked.sourceDigest,
        issues: blocked.issues,
      });
    this.creationScopes.set(this.paths.creation(scope), structuredClone(scope));
    const previous = this.creation.peek(scope);
    return previous?.status === "unavailable" &&
      previous.issues.some(
        (issue) => issue.code === "legacy-conversion-required",
      )
      ? this.creation.reload(scope)
      : this.creation.ensureLoaded(scope);
  }
  async reloadCreation(scope: PreferenceScope) {
    this.retryScope(scope);
    const blocked = await this.prepareScope(scope);
    if (blocked?.status === "unavailable")
      return this.creation.block(scope, {
        path: blocked.path,
        digest: blocked.sourceDigest,
        issues: blocked.issues,
      });
    this.creationScopes.set(this.paths.creation(scope), structuredClone(scope));
    return this.creation.reload(scope);
  }
  async getCreationPreferences(projectId?: string) {
    return readCreationPreferences(
      (scope) => this.loadCreation(scope),
      projectId,
    );
  }
  async captureCreationPreferences(projectId: string) {
    const scopes: PreferenceScope[] = [
      { scope: "user" },
      { scope: "project", projectId },
    ];
    await Promise.all(scopes.map((scope) => this.loadCreation(scope)));
    const current = this.creation.captureGenerations(scopes);
    const view = await this.getCreationPreferences(projectId);
    return { view, isCurrent: current };
  }
  async saveCreation(scope: PreferenceScope, mutation: CreationMutation) {
    return saveCreationPreferences(
      this.creation,
      (scope) => this.loadCreation(scope),
      scope,
      mutation,
    );
  }

  private async prepareScope(scope: PreferenceScope) {
    try {
      if (scope.scope === "user") await this.options.prepareUser?.();
      else await this.options.prepareProject?.(scope.projectId);
      return undefined;
    } catch (error) {
      this.track(scope);
      // track() publishes health on a new store generation. block() reuses a
      // cached failure, so notice-driven reads neither republish nor reload it.
      return this.agents.block(
        scope,
        upgradeBlock(error, this.paths.agent(scope)),
      );
    }
  }
  private async prepareProject(projectId: string): Promise<void> {
    if (await this.prepareScope({ scope: "project", projectId }))
      throw new ScopeUnavailableError();
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
      this.notifySummary(id);
      this.project(() => this.summaries.flush());
      return;
    }
    const summary = conversationSummary(view);
    if (!summary) return;
    try {
      this.summaries.set(id, summary);
      this.notifySummary(id);
      this.project(() => this.summaries.flush());
    } catch {
      /* Disposable cache failure is not configuration publication failure. */
    }
  }
}
