import {
  compileSettingsValidator,
  emptyExtensionsDocument,
  extensionsDocumentSchema,
  fieldScopes,
  resolveExtensions,
  upgradeEntry,
  type ExtensionDiagnostic,
  type ExtensionEntries,
  type ExtensionEntry,
  type ExtensionLayer,
  type ExtensionResolution,
  type ExtensionSettingsDefinition,
  type ExtensionsDocument,
  type SettingIssue,
} from "@nervekit/contracts/extensions";
import type { AppliedProfile } from "@nervekit/contracts/agent-configuration";
import {
  ScopeConflictError,
  ScopedDocumentStore,
  ScopeUnavailableError,
  type ScopedDocumentOptions,
  type ScopeGeneration,
  type ScopeHealth,
} from "../scoped-store/scoped-document-store.js";
import {
  parserIssues,
  type AgentConfigurationPaths,
  type AgentScope,
} from "../agent-configuration/document-adapters.js";
import { projectStorePorts } from "../agent-configuration/project-chains/store-ports.js";
import type { ProjectMigrationService } from "../project-migration/project-migration.js";
import { projectExtensionsConfiguration } from "./project-extensions.js";

export type ExtensionScopeRef = AgentScope;
type Generation = ScopeGeneration<ExtensionScopeRef, ExtensionsDocument>;

/** Conversation and profile context needed to resolve settings for one conversation. */
export type ExtensionContext = {
  projectId?: string;
  conversationId?: string;
  /** Sub-agents resolve from their frozen conversation file alone. */
  role?: "lead" | "child";
  appliedProfile?: Pick<AppliedProfile, "name" | "extensions"> | null;
};

/** What one scope's file contributes, with the project trust decision. */
export type ScopeRead = {
  scope: ExtensionScopeRef;
  status: "ready" | "missing" | "unavailable";
  path: string;
  revision: number;
  digest: string;
  entries: ExtensionEntries;
  /** Project files only: untrusted files are ignored by resolution. */
  trusted: boolean | null;
  issues: { code: string; pointer: string }[];
};

export type SaveInput = {
  id: string;
  /** Replaces the stored entry: omitted keys are removed. */
  entry: { enabled?: boolean; settings?: Record<string, unknown> };
  /** Fields a profile requirement locks; they cannot be set at this scope. */
  locked?: readonly string[];
};

export type ExtensionSaveFailure =
  | { status: "conflict" }
  | { status: "unavailable" }
  | { status: "read-only"; message: string }
  | { status: "invalid"; issues: SettingIssue[] };

/**
 * Extension settings at user, project and conversation scope: revisioned
 * `extensions.json` documents with per-field layered resolution. The project
 * file is used only when its exact content is trusted.
 */
export class ExtensionSettingsService {
  readonly store: ScopedDocumentStore<ExtensionScopeRef, ExtensionsDocument>;
  private readonly known = new Map<string, ExtensionSettingsDefinition>();
  private readonly listeners = new Set<(scope: ExtensionScopeRef) => void>();

  constructor(
    private readonly options: {
      paths: AgentConfigurationPaths;
      projectMigration: ProjectMigrationService;
      definitions: readonly ExtensionSettingsDefinition[];
      isProjectTrusted(
        projectId: string,
        path: string,
        digest: string,
      ): boolean;
      io?: Pick<
        ScopedDocumentOptions<ExtensionScopeRef, ExtensionsDocument>,
        "write" | "syncDirectory"
      >;
    },
  ) {
    for (const definition of options.definitions)
      this.known.set(definition.id, definition);
    this.store = new ScopedDocumentStore({
      ...options.io,
      ...projectStorePorts<ExtensionScopeRef, ExtensionsDocument>(
        options.projectMigration,
        options.paths,
        () => projectExtensionsConfiguration,
      ),
      resolvePath: (scope) => options.paths.extensions(scope),
      required: () => false,
      supportedVersion: 1,
      empty: emptyExtensionsDocument,
      parse: (input) => extensionsDocumentSchema.parse(input),
      issues: parserIssues,
      publish: (value) => {
        for (const listener of this.listeners) listener(value.scope);
      },
    });
  }

  get definitions(): readonly ExtensionSettingsDefinition[] {
    return this.options.definitions;
  }

  /** Called after any scope's document is published. */
  subscribe(listener: (scope: ExtensionScopeRef) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async read(scope: ExtensionScopeRef): Promise<ScopeRead> {
    const health = await this.store.ensureLoaded(scope);
    return this.describe(scope, health);
  }

  reload(scope: ExtensionScopeRef): Promise<ScopeRead> {
    return this.store
      .reload(scope)
      .then((health) => this.describe(scope, health));
  }

  private describe(
    scope: ExtensionScopeRef,
    health: ScopeHealth<ExtensionScopeRef, ExtensionsDocument>,
  ): ScopeRead {
    if (health.status === "unavailable")
      return {
        scope,
        status: "unavailable",
        path: health.path,
        revision: 0,
        digest: health.sourceDigest ?? "missing",
        entries: {},
        trusted: null,
        issues: health.issues.map(({ code, pointer }) => ({ code, pointer })),
      };
    const value = health.value;
    return {
      scope,
      status: health.status === "ready" ? "ready" : "missing",
      path: value.path,
      revision: value.revision,
      digest: value.digest,
      entries: value.document.extensions,
      trusted:
        scope.scope === "project"
          ? value.digest === "missing" ||
            this.options.isProjectTrusted(
              scope.projectId,
              value.path,
              value.digest,
            )
          : null,
      issues: [],
    };
  }

  /** Layers lowest precedence first, plus what could not be used. */
  async layers(
    context: ExtensionContext,
    upTo: ExtensionScopeRef["scope"] = "conversation",
  ): Promise<{ layers: ExtensionLayer[]; diagnostics: ExtensionDiagnostic[] }> {
    const layers: ExtensionLayer[] = [];
    const diagnostics: ExtensionDiagnostic[] = [];
    const skipped = (
      layer: ExtensionLayer["layer"],
      read: ScopeRead,
      code: "file-unavailable" | "untrusted-project",
    ) =>
      diagnostics.push({
        code,
        layer,
        message:
          code === "untrusted-project"
            ? "The project's extension settings are not trusted and are ignored."
            : `The ${layer} extension settings file is unavailable (${read.issues.map((issue) => issue.code).join(", ") || "unreadable"}); defaults apply.`,
      });
    const take = (
      layer: ExtensionLayer["layer"],
      read: ScopeRead,
      extra: Partial<ExtensionLayer> = {},
    ) => {
      if (read.status === "unavailable")
        return skipped(layer, read, "file-unavailable");
      if (read.trusted === false)
        return skipped(layer, read, "untrusted-project");
      layers.push({ layer, entries: read.entries, ...extra });
    };
    const child = context.role === "child";
    if (!child) {
      take("user", await this.read({ scope: "user" }));
      if (upTo !== "user" && context.projectId)
        take(
          "project",
          await this.read({ scope: "project", projectId: context.projectId }),
        );
    }
    if (upTo === "conversation") {
      const profile = context.appliedProfile;
      if (!child && profile?.extensions?.recommendations)
        layers.push({
          layer: "profile",
          profile: profile.name,
          entries: profile.extensions.recommendations,
        });
      if (context.conversationId)
        take(
          "conversation",
          await this.read({
            scope: "conversation",
            conversationId: context.conversationId,
          }),
        );
      if (!child && profile?.extensions?.requirements)
        layers.push({
          layer: "profile",
          profile: profile.name,
          locked: true,
          entries: profile.extensions.requirements,
        });
    }
    return { layers, diagnostics };
  }

  /** Resolution visible at a scope (user: defaults → user; conversation: everything). */
  async resolve(
    context: ExtensionContext,
    upTo: ExtensionScopeRef["scope"] = "conversation",
  ): Promise<ExtensionResolution> {
    const { layers, diagnostics } = await this.layers(context, upTo);
    const resolution = resolveExtensions(this.options.definitions, layers);
    return {
      ...resolution,
      diagnostics: [...diagnostics, ...resolution.diagnostics],
    };
  }

  /** Fields locked by the profile's requirements, per extension. */
  lockedFields(
    profile: ExtensionContext["appliedProfile"],
    id: string,
  ): string[] {
    const entry = profile?.extensions?.requirements?.[id];
    return [
      ...(entry?.enabled !== undefined ? ["enabled"] : []),
      ...Object.keys(entry?.settings ?? {}),
    ];
  }

  /** Validates an entry for a scope: schema, field scopes and profile locks. */
  validateEntry(
    scope: ExtensionScopeRef["scope"],
    save: SaveInput,
  ): { entry: ExtensionEntry | null } | { issues: SettingIssue[] } {
    const definition = this.known.get(save.id);
    if (!definition)
      return {
        issues: [
          {
            code: "unknown-field",
            field: "",
            message: `Unknown extension "${save.id}".`,
          },
        ],
      };
    const validate = compileSettingsValidator(definition.settings);
    const { value, issues } = validate(save.entry.settings);
    for (const key of Object.keys(value)) {
      const field = definition.settings.fields[key];
      if (!fieldScopes(field).includes(scope))
        issues.push({
          code: "invalid-value",
          field: key,
          message: `"${field.label}" cannot be set at ${scope} scope.`,
        });
      if (save.locked?.includes(key))
        issues.push({
          code: "invalid-value",
          field: key,
          message: `"${field.label}" is locked by the agent profile.`,
        });
    }
    if (save.entry.enabled !== undefined && save.locked?.includes("enabled"))
      issues.push({
        code: "invalid-value",
        field: "enabled",
        message: "Enablement is locked by the agent profile.",
      });
    if (issues.length) return { issues };
    if (save.entry.enabled === undefined && !Object.keys(value).length)
      return { entry: null };
    return {
      entry: {
        version: definition.settingsVersion,
        ...(save.entry.enabled !== undefined
          ? { enabled: save.entry.enabled }
          : {}),
        ...(Object.keys(value).length ? { settings: value } : {}),
      },
    };
  }

  /** Replaces one extension's entry; other entries are kept, upgraded where their version is old. */
  async save(
    scope: ExtensionScopeRef,
    expected: { revision: number; digest: string },
    save: SaveInput,
  ): Promise<{ status: "saved"; value: Generation } | ExtensionSaveFailure> {
    const validated = this.validateEntry(scope.scope, save);
    if ("issues" in validated)
      return { status: "invalid", issues: validated.issues };
    return this.mutate(scope, expected, save.id, () => validated.entry);
  }

  /** Removes fields of one entry (`enabled` is a field here), or the whole entry. */
  async reset(
    scope: ExtensionScopeRef,
    expected: { revision: number; digest: string },
    id: string,
    fields?: readonly string[],
  ): Promise<{ status: "saved"; value: Generation } | ExtensionSaveFailure> {
    return this.mutate(scope, expected, id, (current) => {
      if (!current || !fields) return null;
      const settings = { ...current.settings };
      for (const field of fields) delete settings[field];
      const enabled = fields.includes("enabled") ? undefined : current.enabled;
      if (enabled === undefined && !Object.keys(settings).length) return null;
      return {
        version: current.version,
        ...(enabled !== undefined ? { enabled } : {}),
        ...(Object.keys(settings).length ? { settings } : {}),
      };
    });
  }

  private async mutate(
    scope: ExtensionScopeRef,
    expected: { revision: number; digest: string },
    id: string,
    next: (current: ExtensionEntry | undefined) => ExtensionEntry | null,
  ): Promise<{ status: "saved"; value: Generation } | ExtensionSaveFailure> {
    try {
      const health = await this.store.ensureLoaded(scope);
      if (health.status === "unavailable") return { status: "unavailable" };
      const stored = health.value.document.extensions[id];
      const definition = this.known.get(id);
      if (stored && definition && stored.version > definition.settingsVersion)
        return {
          status: "read-only",
          message: `"${id}" settings were saved by a newer version and cannot be changed here.`,
        };
      // Reset works on the upgraded view of the entry.
      const current =
        stored && definition ? upgradeEntry(definition, stored).entry : stored;
      const entry = next(current);
      const { value } = await this.store.save(scope, expected, (document) => {
        const extensions: ExtensionEntries = {};
        for (const [key, existing] of Object.entries(document.extensions)) {
          const def = this.known.get(key);
          const upgrade = def ? upgradeEntry(def, existing) : undefined;
          extensions[key] =
            upgrade?.status === "upgraded" ? upgrade.entry : existing;
        }
        if (entry) extensions[id] = entry;
        else delete extensions[id];
        return { ...document, extensions };
      });
      return { status: "saved", value };
    } catch (error) {
      if (error instanceof ScopeConflictError) return { status: "conflict" };
      if (error instanceof ScopeUnavailableError)
        return { status: "unavailable" };
      throw error;
    }
  }

  /** Writes a sub-agent's frozen settings into its conversation file, once, at creation. */
  async freezeForChild(
    conversationId: string,
    entries: ExtensionEntries,
  ): Promise<void> {
    if (!Object.keys(entries).length) return;
    await this.store.create(
      { scope: "conversation", conversationId },
      { schemaVersion: 1, revision: 1, extensions: entries },
    );
  }

  /** Entries holding every non-default value of a resolution, for freezing. */
  freezeEntries(resolution: ExtensionResolution): ExtensionEntries {
    const entries: ExtensionEntries = {};
    for (const [id, resolved] of Object.entries(resolution.extensions)) {
      const definition = this.known.get(id);
      if (!definition) continue;
      const settings: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(resolved.fields))
        if (field.source.layer !== "default" && field.value !== undefined)
          settings[key] = field.value;
      const enabled =
        resolved.enabled.source.layer !== "default"
          ? resolved.enabled.value
          : undefined;
      if (enabled === undefined && !Object.keys(settings).length) continue;
      entries[id] = {
        version: definition.settingsVersion,
        ...(enabled !== undefined ? { enabled } : {}),
        ...(Object.keys(settings).length ? { settings } : {}),
      };
    }
    return entries;
  }
}
