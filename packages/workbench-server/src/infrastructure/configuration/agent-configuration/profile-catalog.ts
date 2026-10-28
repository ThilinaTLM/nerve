import { readConfigurationDigest } from "./configuration-bytes.js";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  profileDefinitionSchema,
  type ProfileCatalogEntry,
} from "@nervekit/contracts/agent-configuration";
import {
  ScopedDocumentStore,
  digestBytes,
  freezeJson,
  type ScopedDocumentOptions,
  type ScopeHealth,
  ScopeConflictError,
  ScopeUnavailableError,
} from "../scoped-store/scoped-document-store.js";
import { withFileMutation } from "../../storage-bootstrap/file-mutations.js";
import {
  errorCode,
  synchronizeDirectory,
} from "../scoped-store/durable-write.js";
import {
  AgentConfigurationPaths,
  diagnostic,
  healthDiagnostics,
  parserIssues,
  type AgentScope,
  type ConfigurationDiagnostic,
  type PreferenceScope,
  type ProfileDefinition,
} from "./document-adapters.js";

type ProfileScope = PreferenceScope & { name: string };
export type ProfileLookup =
  | {
      status: "available";
      source: "builtin" | "user" | "project";
      digest: string;
      definition: Readonly<ProfileDefinition>;
      diagnostics: readonly ConfigurationDiagnostic[];
    }
  | { status: "unavailable"; diagnostics: readonly ConfigurationDiagnostic[] };
export interface ProfileCatalogOptions {
  paths: AgentConfigurationPaths;
  prepareProject?(projectId: string): Promise<void>;
  /** Authored bundled bytes, not legacy profile formats. */
  builtins: Readonly<Record<string, string>>;
  isTrusted(projectId: string, path: string, exactDigest: string): boolean;
  publish?(scope: AgentScope): void;
  invalidate?(scope: AgentScope): void;
  io?: Pick<
    ScopedDocumentOptions<ProfileScope, ProfileDefinition>,
    "write" | "syncDirectory"
  >;
}

/** Complete-definition shadowing: invalid/untrusted project entries never fall through. */
export class AgentProfileCatalog {
  private readonly store: ScopedDocumentStore<ProfileScope, ProfileDefinition>;
  private readonly extraDiagnostics = new Map<
    string,
    readonly ConfigurationDiagnostic[]
  >();
  private readonly loaded = new Map<string, ProfileScope>();
  private readonly listings = new Map<
    string,
    Promise<{ names: string[]; diagnostics: ConfigurationDiagnostic[] }>
  >();
  constructor(private readonly options: ProfileCatalogOptions) {
    this.store = new ScopedDocumentStore({
      ...options.io,
      resolvePath: (scope) => options.paths.profile(scope, scope.name),
      required: () => true,
      revisioned: false,
      supportedVersion: 1,
      parse: (input, scope) => {
        const parsed = profileDefinitionSchema.parse(input);
        if (parsed.name !== scope.name)
          throw new Error("Profile name differs from filename");
        return parsed;
      },
      empty: () => {
        throw new Error("Missing definitions have no default");
      },
      issues: parserIssues,
      publish: (value) => options.publish?.(value.scope),
    });
  }

  private async read(
    scope: ProfileScope,
  ): Promise<ScopeHealth<ProfileScope, ProfileDefinition>> {
    this.track(scope);
    return this.store.ensureLoaded(scope);
  }

  private track(scope: ProfileScope): void {
    const key = this.options.paths.profile(scope, scope.name);
    if (this.loaded.has(key)) return;
    this.loaded.set(key, scope);
    this.store.onInvalidate(scope, () => this.options.invalidate?.(scope));
  }

  async get(
    name: string,
    projectId?: string,
    role: "lead" | "child" = "lead",
  ): Promise<ProfileLookup> {
    if (projectId) await this.options.prepareProject?.(projectId);
    profileDefinitionSchema.shape.name.parse(name);
    const scopes: PreferenceScope[] = projectId
      ? [{ scope: "project", projectId }, { scope: "user" }]
      : [{ scope: "user" }];
    const targets = scopes.map((scope) => ({ ...scope, name }));
    await Promise.all(targets.map((scope) => this.read(scope)));
    for (const scope of targets) {
      const health = this.store.peek(scope)!;
      if (health.status === "unavailable") {
        if (health.issues.every((issue) => issue.code === "missing-required"))
          continue;
        return {
          status: "unavailable",
          diagnostics: healthDiagnostics(health, `profile:${name}`),
        };
      }
      const value = health.value;
      const diagnostics: ConfigurationDiagnostic[] = [];
      if (
        scope.scope === "project" &&
        !this.options.isTrusted(scope.projectId, value.path, value.digest)
      )
        diagnostics.push(
          diagnostic(scope, `profile:${name}`, value.path, "untrusted"),
        );
      return this.available(
        value.document,
        scope.scope,
        value.digest,
        role,
        scope,
        value.path,
        diagnostics,
      );
    }
    const bytes = Object.hasOwn(this.options.builtins, name)
      ? this.options.builtins[name]
      : undefined;
    const file = `builtin:${name}`;
    if (bytes !== undefined) {
      let input: unknown;
      try {
        input = JSON.parse(bytes);
      } catch {
        return this.builtinFailure(name, [
          diagnostic(
            { scope: "user" },
            `profile:${name}`,
            file,
            "malformed-json",
          ),
        ]);
      }
      try {
        const definition = profileDefinitionSchema.parse(input);
        if (definition.name !== name)
          throw new Error("Profile name differs from builtin identity");
        this.extraDiagnostics.delete(file);
        return this.available(
          definition,
          "builtin",
          digestBytes(bytes),
          role,
          { scope: "user" },
          file,
          [],
        );
      } catch (error) {
        const version =
          typeof input === "object" &&
          input !== null &&
          "schemaVersion" in input &&
          typeof input.schemaVersion === "number"
            ? input.schemaVersion
            : undefined;
        const issues =
          version !== undefined && Number.isInteger(version) && version > 1
            ? [{ code: "future-version", pointer: "/schemaVersion" }]
            : parserIssues(error);
        return this.builtinFailure(
          name,
          issues.map((issue) =>
            diagnostic(
              { scope: "user" },
              `profile:${name}`,
              file,
              issue.code,
              issue.pointer,
              version,
            ),
          ),
        );
      }
    }
    return {
      status: "unavailable",
      diagnostics: [
        diagnostic(
          { scope: "user" },
          `profile:${name}`,
          file,
          "missing-profile",
        ),
      ],
    };
  }

  private builtinFailure(
    name: string,
    diagnostics: ConfigurationDiagnostic[],
  ): ProfileLookup {
    this.extraDiagnostics.set(`builtin:${name}`, diagnostics);
    return { status: "unavailable", diagnostics };
  }

  private available(
    definition: Readonly<ProfileDefinition>,
    source: "builtin" | "user" | "project",
    digest: string,
    role: "lead" | "child",
    scope: PreferenceScope,
    file: string,
    diagnostics: ConfigurationDiagnostic[],
  ): ProfileLookup {
    if (
      (role === "lead" && definition.usableBy === "subagent") ||
      (role === "child" && definition.usableBy === "lead")
    )
      diagnostics.push(
        diagnostic(
          scope,
          `profile:${definition.name}`,
          file,
          "inapplicable-profile",
        ),
      );
    return freezeJson(
      diagnostics.length
        ? { status: "unavailable" as const, diagnostics }
        : {
            status: "available" as const,
            source,
            digest,
            definition: structuredClone(definition),
            diagnostics,
          },
    );
  }

  private names(
    scope: PreferenceScope,
  ): Promise<{ names: string[]; diagnostics: ConfigurationDiagnostic[] }> {
    const directory = this.options.paths.profiles(scope);
    let cached = this.listings.get(directory);
    if (!cached) {
      cached = (async () => {
        try {
          const names: string[] = [];
          const diagnostics: ConfigurationDiagnostic[] = [];
          for (const file of await readdir(directory)) {
            if (!file.endsWith(".json")) continue;
            const name = file.slice(0, -5);
            if (profileDefinitionSchema.shape.name.safeParse(name).success)
              names.push(name);
            else
              diagnostics.push(
                diagnostic(
                  scope,
                  `profile:${name}`,
                  path.join(directory, file),
                  "invalid-value",
                  "/name",
                ),
              );
          }
          this.extraDiagnostics.set(directory, freezeJson(diagnostics));
          return { names, diagnostics };
        } catch (error) {
          const diagnostics =
            errorCode(error) === "ENOENT"
              ? []
              : [diagnostic(scope, "profile:catalog", directory, "io-error")];
          this.extraDiagnostics.set(directory, diagnostics);
          return { names: [], diagnostics };
        }
      })();
      this.listings.set(directory, cached);
    }
    return cached;
  }

  async list(
    projectId?: string,
    role: "lead" | "child" = "lead",
  ): Promise<{
    profiles: Record<string, ProfileLookup>;
    diagnostics: ConfigurationDiagnostic[];
  }> {
    if (projectId) await this.options.prepareProject?.(projectId);
    const user = await this.names({ scope: "user" });
    const project = projectId
      ? await this.names({ scope: "project", projectId })
      : { names: [], diagnostics: [] };
    const names = [
      ...new Set([
        ...Object.keys(this.options.builtins),
        ...user.names,
        ...project.names,
      ]),
    ].sort();
    return {
      profiles: Object.fromEntries(
        await Promise.all(
          names.map(async (name) => [
            name,
            await this.get(name, projectId, role),
          ]),
        ),
      ),
      diagnostics: [...user.diagnostics, ...project.diagnostics],
    };
  }

  /** Editing can inspect untrusted definitions, but never bypass application checks. */
  async readForEditing(
    scope: PreferenceScope,
    name: string,
    role: "lead" | "child" = "lead",
  ): Promise<{ profile: ProfileCatalogEntry; localDigest: string }> {
    profileDefinitionSchema.shape.name.parse(name);
    if (scope.scope === "project")
      await this.options.prepareProject?.(scope.projectId);
    const scopes: PreferenceScope[] =
      scope.scope === "project" ? [scope, { scope: "user" }] : [scope];
    let localDigest = "missing";
    for (const [index, current] of scopes.entries()) {
      const state = await this.read({ ...current, name });
      const digest =
        state.status === "unavailable"
          ? (state.sourceDigest ?? "missing")
          : state.value.digest;
      if (index === 0) localDigest = digest;
      if (
        state.status === "unavailable" &&
        state.issues.every((issue) => issue.code === "missing-required")
      )
        continue;
      const definition =
        state.status === "unavailable" ? null : state.value.document;
      const file = this.options.paths.profile(current, name);
      const trusted =
        current.scope !== "project" ||
        this.options.isTrusted(current.projectId, file, digest);
      const shadows =
        index === 0 ? await this.lowerSource(scopes.slice(1), name) : undefined;
      return {
        localDigest,
        profile: {
          name,
          source: current.scope,
          path: file,
          digest,
          definition,
          trusted,
          applicable:
            !!definition &&
            (definition.usableBy === "both" ||
              definition.usableBy === (role === "lead" ? "lead" : "subagent")),
          enabled: definition?.enabled !== false,
          local: index === 0,
          ...(shadows ? { shadows } : {}),
          diagnostics: [
            ...healthDiagnostics(state, `profile:${name}`),
            ...(!trusted
              ? [diagnostic(current, `profile:${name}`, file, "untrusted")]
              : []),
          ],
        },
      };
    }
    const bytes = this.options.builtins[name];
    if (bytes === undefined) throw new Error("Profile not found");
    const definition = profileDefinitionSchema.parse(JSON.parse(bytes));
    return {
      localDigest,
      profile: {
        name,
        source: "builtin",
        path: `builtin:${name}`,
        digest: digestBytes(bytes),
        definition,
        trusted: true,
        applicable:
          definition.usableBy === "both" ||
          definition.usableBy === (role === "lead" ? "lead" : "subagent"),
        enabled: definition.enabled !== false,
        local: false,
        diagnostics: [],
      },
    };
  }

  /** The first lower layer that defines `name`, if any. */
  private async lowerSource(
    scopes: PreferenceScope[],
    name: string,
  ): Promise<"user" | "builtin" | undefined> {
    for (const current of scopes) {
      const state = await this.read({ ...current, name });
      if (
        state.status !== "unavailable" ||
        !state.issues.every((issue) => issue.code === "missing-required")
      )
        return current.scope === "user" ? "user" : undefined;
    }
    return this.options.builtins[name] === undefined ? undefined : "builtin";
  }

  async listForEditing(
    scope: PreferenceScope,
    role: "lead" | "child" = "lead",
  ) {
    if (scope.scope === "project")
      await this.options.prepareProject?.(scope.projectId);
    const user = await this.names({ scope: "user" });
    const project =
      scope.scope === "project"
        ? await this.names(scope)
        : { names: [], diagnostics: [] };
    const names = [
      ...new Set([
        ...Object.keys(this.options.builtins),
        ...user.names,
        ...project.names,
      ]),
    ].sort();
    return {
      profiles: await Promise.all(
        names.map(
          async (name) =>
            (await this.readForEditing(scope, name, role)).profile,
        ),
      ),
      diagnostics: [...user.diagnostics, ...project.diagnostics],
    };
  }

  async deleteLocal(
    scope: PreferenceScope,
    name: string,
    expectedDigest: string,
  ) {
    const target = { ...scope, name };
    const file = this.options.paths.profile(scope, name);
    this.track(target);
    await withFileMutation(file, async () => {
      if ((await readConfigurationDigest(file)) !== expectedDigest)
        throw new ScopeConflictError();
      if (expectedDigest !== "missing") {
        // Invalid content must go through confirmed repair with backup/receipt,
        // not an ordinary catalog delete that would discard its original bytes.
        try {
          profileDefinitionSchema.parse(
            JSON.parse(await readFile(file, "utf8")),
          );
        } catch {
          throw new ScopeUnavailableError();
        }
        await unlink(file);
      }
      if (expectedDigest !== "missing")
        await (this.options.io?.syncDirectory ?? synchronizeDirectory)(file);
    });
    await this.reload(scope, name);
    return { status: "saved" as const, digest: "missing" };
  }

  async save(
    scope: PreferenceScope,
    name: string,
    expectedDigest: string,
    input: unknown,
  ) {
    const target = { ...scope, name };
    this.track(target);
    const result =
      expectedDigest === "missing"
        ? await this.store.create(target, input)
        : await this.store.save(
            target,
            { revision: 0, digest: expectedDigest },
            () => input,
          );
    this.listings.delete(this.options.paths.profiles(scope));
    return {
      digest: result.value.digest,
      definition: result.value.document,
      durability: result.durability,
    };
  }

  async reload(scope: PreferenceScope, name: string) {
    const target = { ...scope, name };
    this.track(target);
    this.listings.delete(this.options.paths.profiles(scope));
    return this.store.reload(target);
  }

  async reloadCatalog(scope: PreferenceScope): Promise<void> {
    this.listings.delete(this.options.paths.profiles(scope));
    const known = [...this.loaded.values()].filter(
      (entry) =>
        entry.scope === scope.scope &&
        (scope.scope === "user" ||
          (entry.scope === "project" && entry.projectId === scope.projectId)),
    );
    await Promise.all(known.map((entry) => this.store.reload(entry)));
    await this.names(scope);
  }

  health(): ConfigurationDiagnostic[] {
    return [
      ...[...this.extraDiagnostics.values()].flat(),
      ...[...this.loaded.values()].flatMap((scope) => {
        const health = this.store.peek(scope);
        if (
          !health ||
          (health.status === "unavailable" &&
            health.issues.every((issue) => issue.code === "missing-required"))
        )
          return [];
        return healthDiagnostics(health, `profile:${scope.name}`);
      }),
    ];
  }
}
