import { join } from "node:path";
import type {
  AccountKind,
  ExtensionCatalogDiagnostic,
  ExtensionConsent,
  ExtensionCatalogEntry,
  ExtensionSettingsDefinition,
  ExtensionSource,
  ExtensionState,
  InstalledExtensionManifest,
  ThemeFile,
} from "@nervekit/contracts/extensions";
import type { ExtensionDefinition } from "@nervekit/extension-api";
import {
  setScopedToolDefinitions,
  toolDefinitionByName,
} from "@nervekit/tools/catalog";
import {
  createExtensionToolDefinitions,
  createQuickScriptRegistry,
  extensionSettingsDefinition,
  reservedNamespaceIds,
  routedExtensionCode,
  sandboxExtensionCode,
  type QuickScriptRegistry,
} from "@nervekit/tools/quick-script";
import { limitInstalledErrors } from "./agent-text-limits.js";
import {
  loadInstalledExtension,
  type LoadedInstalledExtension,
} from "./load-installed.js";
import {
  readInstalledExtensions,
  type ReadExtension,
} from "./read-installed.js";
import {
  pendingConsentGate,
  type ExtensionTrustGate,
  type ExtensionTrustVerdict,
  type InstalledExtensionCandidate,
} from "./trust-gate.js";

/** What a consumer needs of the catalog: the registry and the entries at a project. */
export interface ExtensionRegistryProvider {
  registryFor(projectDir?: string): Promise<QuickScriptRegistry>;
  entries(projectDir?: string): Promise<ExtensionCatalogEntry[]>;
}

/**
 * What changes consent and what is loaded. Reachable only from the signed-in
 * user's Settings page (the `extensions.*` operations of the workbench protocol); no agent tool,
 * `quick_script` namespace or extension port exposes it.
 */
export interface ExtensionManagement {
  grantConsent(
    ref: InstalledExtensionRef,
    contentHash: string,
  ): Promise<"granted" | "changed" | "not_found">;
  revokeConsent(ref: InstalledExtensionRef): Promise<boolean>;
  reload(id?: string): Promise<void>;
}

/** A provider of one fixed registry whose extensions are all built in (tests, tools without a home). */
export function fixedRegistryProvider(
  registry: QuickScriptRegistry,
): ExtensionRegistryProvider {
  return {
    registryFor: async () => registry,
    entries: async () =>
      registry.extensions.map((extension) => ({
        id: extension.id,
        source: extension.source,
        state: "enabled" as const,
        name: extension.name,
        description: extension.description,
        diagnostics: [],
      })),
  };
}

/** The built-in extensions a catalog composes with; the host's list (`@nervekit/tools` cannot import it). */
export type BuiltinExtensions = {
  definitions: readonly ExtensionDefinition[];
  /** Reads a declared file (doc topic, icon) of a built-in. */
  readAsset(extensionId: string, file: string): string;
  /** The built-ins that run in the sandbox, and how to read their bundle; the others run in the host process. */
  sandboxed: ReadonlySet<string>;
  readBundle(extensionId: string): string;
};

/** An installed extension a consent operation names. */
export type InstalledExtensionRef = {
  source: "user" | "project";
  id: string;
  /** The project directory of a project extension. */
  projectDir?: string;
};

export type ExtensionCatalogOptions = {
  /** `NERVE_HOME`: user extensions live in `<home>/agent/extensions/`. */
  home: string;
  /** The running Nerve's version; the upper bound of the SDK range. */
  nerveVersion: string;
  builtins: BuiltinExtensions;
  /** Consulted before an installed extension is registered or its code opened; default: nothing is trusted. */
  trustGate?: ExtensionTrustGate;
  warn?(message: string, data?: unknown): void;
};

/** An enabled, consented installed extension that contributes UI (frames and themes). */
export type InstalledUiExtension = {
  id: string;
  name: string;
  source: "user" | "project";
  /** The extension's `dist/` folder: frames are served from `dist/ui/<id>/`, themes read from `dist/themes/<id>.json`. */
  dist: string;
  ui: NonNullable<InstalledExtensionManifest["ui"]>;
  /** The themes that passed the theme file schema and the readability rules (user extensions only). */
  themes: ThemeFile[];
};

/** Where the server reads the UI contributions of installed extensions from. */
export interface ExtensionUiSource {
  /** Loaded installed extensions with a `ui` section at a project (none: the user's extensions only). Pending, invalid and shadowed extensions are not in it. */
  installedUi(projectDir?: string): Promise<InstalledUiExtension[]>;
}

/** The registry for one project (or none), with what the catalog knows of each extension. */
export type ComposedExtensions = {
  registry: QuickScriptRegistry;
  entries: ExtensionCatalogEntry[];
  ui: InstalledUiExtension[];
};

type ScannedExtension = {
  read: ReadExtension;
  source: "user" | "project";
  /** What the gate was asked about; absent when the folder is invalid or incompatible. */
  candidate?: InstalledExtensionCandidate;
  consent?: ExtensionConsent;
  /** What the trust gate and the load decided, before precedence and collisions. */
  state: "loadable" | Exclude<ExtensionState, "enabled" | "shadowed">;
  loaded?: LoadedInstalledExtension;
  diagnostics: ExtensionCatalogDiagnostic[];
};
type Scan = Map<string, ScannedExtension>;
/** What precedence and collisions made of one scanned extension. */
type Outcome = {
  state: ExtensionState | "loadable";
  diagnostics: ExtensionCatalogDiagnostic[];
  consent?: ExtensionConsent;
  shadowedBy?: ExtensionSource;
};

const userRootOf = (home: string) => join(home, "agent", "extensions");
const projectRootOf = (projectDir: string) =>
  join(projectDir, ".nerve", "extensions");

/**
 * The server-side catalog of extensions: built-ins, user extensions (`<home>/agent/extensions/`)
 * and a project's (`<project>/.nerve/extensions/`), composed per project into a
 * `QuickScriptRegistry`. Precedence is project, user, built-in; the first id wins and shadowed
 * entries stay visible. There are no file watchers: `reload` re-reads, and the change applies to
 * the next request that asks for a registry.
 */
export class ExtensionCatalog implements ExtensionUiSource {
  readonly #options: ExtensionCatalogOptions;
  readonly #gate: ExtensionTrustGate;
  /** Scans by root path, shared by every composition that includes the root. */
  readonly #scans = new Map<string, Promise<Scan>>();
  readonly #composed = new Map<string, Promise<ComposedExtensions>>();
  /** The last registry composed per project directory (and `""` for none), for callers that cannot wait. */
  readonly #latest = new Map<string, ComposedExtensions>();
  /** The sandbox bundle of each installed definition; only these run, and only in the sandbox. */
  readonly #bundles = new WeakMap<ExtensionDefinition, string>();
  readonly #listeners = new Set<() => void>();
  /** The tool scopes this catalog published to, to withdraw them on reload. */
  readonly #toolScopes = new Set<string>();
  readonly #builtinRegistry: QuickScriptRegistry;
  #generation = 0;

  constructor(options: ExtensionCatalogOptions) {
    this.#options = options;
    this.#gate = options.trustGate ?? pendingConsentGate;
    this.#builtinRegistry = this.#createRegistry([], new Map());
    this.#latest.set("", {
      registry: this.#builtinRegistry,
      entries: this.#builtinEntries(),
      ui: [],
    });
  }

  /** The registry for a project (none: built-ins and user extensions): what the `quick_script` description, direct tools and the permission scan read. */
  async registryFor(projectDir?: string): Promise<QuickScriptRegistry> {
    return (await this.compose(projectDir)).registry;
  }

  async installedUi(projectDir?: string): Promise<InstalledUiExtension[]> {
    return (await this.compose(projectDir)).ui;
  }

  /** Every extension known at a project, loaded or not, with state, source, folder and diagnostics. */
  async entries(projectDir?: string): Promise<ExtensionCatalogEntry[]> {
    return (await this.compose(projectDir)).entries;
  }

  /** The last composition for a project, or the built-ins' before anything was loaded. For callers that cannot await. */
  cached(projectDir?: string): ComposedExtensions {
    return (
      this.#latest.get(projectDir ? resolveKey(projectDir) : "") ??
      this.#latest.get("") ??
      (undefined as never)
    );
  }

  /** Settings definitions of the extensions at a project (without a project: every composition so far). */
  settingsDefinitions(projectDir?: string): ExtensionSettingsDefinition[] {
    const registries = projectDir
      ? [this.cached(projectDir).registry]
      : [...this.#latest.values()].map((composed) => composed.registry);
    const seen = new Map<string, ExtensionSettingsDefinition>();
    for (const registry of registries)
      for (const extension of registry.extensions)
        if (!seen.has(extension.id))
          seen.set(extension.id, extensionSettingsDefinition(extension));
    return [...seen.values()];
  }

  /** Account kinds of every extension composed so far (accounts are user-wide; kinds are unique across scopes). */
  accountKinds(): AccountKind[] {
    const kinds = new Map<string, AccountKind>();
    for (const { registry } of this.#latest.values())
      for (const extension of registry.extensions)
        for (const kind of extension.accounts ?? [])
          if (!kinds.has(kind.kind)) kinds.set(kind.kind, kind);
    return [...kinds.values()];
  }

  /** Called after `reload`. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Re-reads installed extensions: all, or only the folder `id` (in every root read so far; the
   * others keep what they had). Consulting the trust gate again is part of it, and a reload never
   * grants consent. Changes apply to the next request that asks for a registry.
   */
  async reload(id?: string): Promise<void> {
    this.#generation++;
    this.#composed.clear();
    for (const scope of this.#toolScopes) setScopedToolDefinitions(scope, []);
    this.#toolScopes.clear();
    if (id === undefined) this.#scans.clear();
    else {
      const rescans: Promise<Scan>[] = [];
      for (const [root, pending] of [...this.#scans]) {
        const rescan = pending.then((previous) =>
          this.#rescan(root, previous, id),
        );
        this.#scans.set(root, rescan);
        rescans.push(rescan);
      }
      await Promise.all(rescans);
    }
    this.#latest.clear();
    this.#latest.set("", {
      registry: this.#builtinRegistry,
      entries: this.#builtinEntries(),
      ui: [],
    });
    // The user-level extensions' account kinds are needed before the next request asks.
    await this.compose().catch((error) =>
      this.#options.warn?.("Installed extensions could not be read", error),
    );
    for (const listener of this.#listeners) listener();
  }

  // ── Scanning ────────────────────────────────────────────────────────────

  compose(projectDir?: string): Promise<ComposedExtensions> {
    const key = projectDir ? resolveKey(projectDir) : "";
    let composed = this.#composed.get(key);
    if (!composed) {
      const generation = this.#generation;
      composed = (async () => {
        const user = await this.#scan(userRootOf(this.#options.home), "user");
        const project = projectDir
          ? await this.#scan(projectRootOf(key), "project", key)
          : new Map<string, ScannedExtension>();
        const result = this.#compose(user, project);
        if (generation === this.#generation) this.#latest.set(key, result);
        if (generation === this.#generation)
          this.#publishTools(key, result.registry);
        return result;
      })();
      this.#composed.set(key, composed);
      composed.catch(() => this.#composed.delete(key));
    }
    return composed;
  }

  // ── Consent (the user's Settings page only; see the operations in the app protocol) ──

  /** Records consent for the files the user reviewed. `changed` when they are not the files on disk now. */
  async grantConsent(
    ref: InstalledExtensionRef,
    contentHash: string,
  ): Promise<"granted" | "changed" | "not_found"> {
    const found = await this.#find(ref);
    if (!found?.candidate) return "not_found";
    if (!this.#gate.grant) throw new Error("This host does not record consent");
    const granted = await this.#gate.grant(found.candidate, contentHash);
    await this.reload(ref.id);
    return granted ? "granted" : "changed";
  }

  async revokeConsent(ref: InstalledExtensionRef): Promise<boolean> {
    const found = await this.#find(ref);
    if (!found?.candidate) return false;
    await this.#gate.revoke?.(found.candidate);
    await this.reload(ref.id);
    return true;
  }

  async #find(
    ref: InstalledExtensionRef,
  ): Promise<ScannedExtension | undefined> {
    if (ref.source === "project" && !ref.projectDir) return undefined;
    const scan =
      ref.source === "user"
        ? await this.#scan(userRootOf(this.#options.home), "user")
        : await this.#scan(
            projectRootOf(resolveKey(ref.projectDir!)),
            "project",
            resolveKey(ref.projectDir!),
          );
    return [...scan.values()].find(
      (scanned) => scanned.read.manifest?.id === ref.id,
    );
  }

  #scan(root: string, source: "user" | "project", projectDir?: string) {
    let scan = this.#scans.get(root);
    if (!scan) {
      scan = this.#readRoot(root, source, projectDir);
      this.#scans.set(root, scan);
      scan.catch(() => this.#scans.delete(root));
    }
    return scan;
  }

  async #readRoot(
    root: string,
    source: "user" | "project",
    projectDir?: string,
  ): Promise<Scan> {
    const scan: Scan = new Map();
    for (const read of await readInstalledExtensions(
      root,
      this.#options.nerveVersion,
    ))
      scan.set(read.folderName, await this.#evaluate(read, source, projectDir));
    return scan;
  }

  async #rescan(root: string, previous: Scan, id: string): Promise<Scan> {
    const source = root === userRootOf(this.#options.home) ? "user" : "project";
    const projectDir =
      source === "project"
        ? root.slice(0, -"/.nerve/extensions".length)
        : undefined;
    const scan: Scan = new Map();
    for (const read of await readInstalledExtensions(
      root,
      this.#options.nerveVersion,
    )) {
      const kept = previous.get(read.folderName);
      scan.set(
        read.folderName,
        read.folderName !== id && kept
          ? kept
          : await this.#evaluate(read, source, projectDir),
      );
    }
    return scan;
  }

  /** Validates, then consults the trust gate, then (only when trusted) opens the code. */
  async #evaluate(
    read: ReadExtension,
    source: "user" | "project",
    projectDir?: string,
  ): Promise<ScannedExtension> {
    const base: ScannedExtension = {
      read,
      source,
      state: "invalid",
      diagnostics: [...read.diagnostics],
    };
    const manifest = read.manifest;
    if (!manifest) return { ...base, state: "invalid" };
    if (read.incompatible)
      return {
        ...base,
        state: "incompatible",
        diagnostics: [{ level: "error", message: read.incompatible }],
      };
    if (source === "project" && (manifest.ui?.themes?.length ?? 0) > 0)
      base.diagnostics.push({
        level: "warning",
        message:
          "Themes of project extensions are ignored: a theme applies to the whole app, which shows several projects. Install the extension at user level to use its themes.",
      });
    for (const theme of read.themes ?? [])
      if ("problems" in theme)
        base.diagnostics.push({
          level: "warning",
          message: `The theme '${theme.id}' is not offered: ${theme.problems.join("; ")}`,
        });
    const candidate: InstalledExtensionCandidate = {
      id: manifest.id,
      source,
      folder: read.folder,
      ...(projectDir ? { projectDir } : {}),
      manifest,
    };
    const verdict = await this.#gate.decide(candidate);
    const { decision, consent }: ExtensionTrustVerdict =
      typeof verdict === "string" ? { decision: verdict } : verdict;
    base.candidate = candidate;
    if (decision === "pending")
      return {
        ...base,
        state: "pending_consent",
        ...(consent ? { consent } : {}),
        diagnostics: [
          ...base.diagnostics,
          {
            level: "warning",
            message:
              "Waiting for your consent: the extension is listed, but its code is not opened until you consent in Settings → Extensions.",
          },
        ],
      };
    const loaded = await loadInstalledExtension(read.folder, manifest);
    if ("error" in loaded)
      return {
        ...base,
        state: "invalid",
        diagnostics: [
          ...base.diagnostics,
          { level: "error", message: loaded.error },
        ],
      };
    const problem = this.#validateAlone(read, loaded.definition);
    if (problem)
      return {
        ...base,
        state: "invalid",
        diagnostics: [
          ...base.diagnostics,
          { level: "error", message: problem },
        ],
      };
    this.#bundles.set(loaded.definition, loaded.bundle);
    return { ...base, state: "loadable", loaded };
  }

  /** What the registry would reject about this extension on its own (views, icon, duplicates, tool bindings), as a message. */
  #validateAlone(
    read: ReadExtension,
    definition: ExtensionDefinition,
  ): string | undefined {
    const reserved = reservedNamespaceIds();
    for (const namespace of definition.namespaces)
      if (reserved.has(namespace.id))
        return `The namespace '${namespace.id}' is reserved by the runtime. Rename it.`;
    for (const tool of definition.tools ?? [])
      if ("method" in tool) {
        const [id, ...path] = tool.method.split(".");
        const target = definition.namespaces.find(
          (namespace) => namespace.id === id,
        );
        if (!target || !(path.join(".") in target.methods))
          return `The tool '${tool.name}' is bound to '${tool.method}', which is not a method of this extension.`;
      }
    try {
      const alone = createQuickScriptRegistry([definition], {
        readExtensionAsset: (_id, file) => read.readAsset!(file),
      });
      createExtensionToolDefinitions(alone);
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
    return undefined;
  }

  // ── Composition ─────────────────────────────────────────────────────────

  #builtinEntries(): ExtensionCatalogEntry[] {
    return this.#options.builtins.definitions.map((definition) => ({
      id: definition.id,
      source: "builtin",
      state: "enabled",
      name: definition.name,
      description: definition.description,
      diagnostics: [],
    }));
  }

  #createRegistry(
    installed: readonly ExtensionDefinition[],
    sources: ReadonlyMap<ExtensionDefinition, ScannedExtension>,
  ): QuickScriptRegistry {
    const { builtins } = this.#options;
    const assets = new Map(
      [...sources].map(([definition, scanned]) => [
        definition.id,
        scanned.read.readAsset!,
      ]),
    );
    return createQuickScriptRegistry([...builtins.definitions, ...installed], {
      readExtensionAsset: (id, file) => {
        const read = assets.get(id);
        return read ? read(file) : builtins.readAsset(id, file);
      },
      extensionSource: (definition) =>
        sources.get(definition)?.source ?? "builtin",
      extensionCodeAdapter: limitInstalledErrors(
        routedExtensionCode({
          // Installed extensions always run in the sandbox; so do the built-ins that ship a bundle.
          sandboxed: (definition) =>
            this.#bundles.has(definition) ||
            builtins.sandboxed.has(definition.id),
          sandbox: sandboxExtensionCode({
            bundle: (definition) =>
              this.#bundles.get(definition) ??
              builtins.readBundle(definition.id),
          }),
        }),
        (definition) => this.#bundles.has(definition),
      ),
    });
  }

  /** Precedence, collisions and the registry for one project's view of the roots. */
  #compose(user: Scan, project: Scan): ComposedExtensions {
    const { builtins } = this.#options;
    const entries: ExtensionCatalogEntry[] = this.#builtinEntries();
    const builtinIds = new Set(builtins.definitions.map((d) => d.id));
    const claimed = new Map<string, ExtensionSource>(
      [...builtinIds].map((id) => [id, "builtin"]),
    );
    const kinds = new Set(
      builtins.definitions.flatMap((d) => Object.keys(d.accounts ?? {})),
    );
    const namespaces = new Set(
      builtins.definitions.flatMap((d) => d.namespaces.map((n) => n.id)),
    );
    const tools = new Set(
      builtins.definitions.flatMap((d) => (d.tools ?? []).map((t) => t.name)),
    );

    // First id wins in precedence order (project, user, built-in); an invalid folder claims nothing.
    const outcomes = new Map<ScannedExtension, Outcome>();
    for (const scanned of [...project.values(), ...user.values()]) {
      const manifest = scanned.read.manifest;
      const outcome: Outcome = {
        state: scanned.state,
        diagnostics: [...scanned.diagnostics],
        ...(scanned.consent ? { consent: scanned.consent } : {}),
      };
      outcomes.set(scanned, outcome);
      if (!manifest) continue;
      const owner = claimed.get(manifest.id);
      if (owner === "builtin") {
        outcome.state = "invalid";
        outcome.diagnostics.push({
          level: "error",
          message: `The id '${manifest.id}' belongs to a built-in extension; an installed extension cannot take it. Choose another id.`,
        });
      } else if (owner) {
        outcome.state = "shadowed";
        outcome.shadowedBy = owner;
        outcome.diagnostics.push({
          level: "warning",
          message: `Shadowed by the ${owner} extension with the same id.`,
        });
      } else claimed.set(manifest.id, scanned.source);
    }

    // Collisions: built-ins hold their names, then user extensions, then the project's, so a
    // repository's extension can never take an account kind (and its credentials) from one you use.
    const accepted: ScannedExtension[] = [];
    for (const scanned of [...user.values(), ...project.values()]) {
      const outcome = outcomes.get(scanned)!;
      if (outcome.state !== "loadable") continue;
      const { definition } = scanned.loaded!;
      const problems = [
        ...Object.keys(definition.accounts ?? {})
          .filter((kind) => kinds.has(kind))
          .map(
            (kind) =>
              `The account kind '${kind}' is already defined by another extension.`,
          ),
        ...definition.namespaces
          .filter((namespace) => namespaces.has(namespace.id))
          .map(
            (namespace) =>
              `The namespace '${namespace.id}' is already defined by another extension.`,
          ),
        ...(definition.tools ?? [])
          .filter((tool) => {
            // Core and built-in tools are global; installed extensions' tools are per project.
            return tools.has(tool.name) || toolDefinitionByName(tool.name);
          })
          .map(
            (tool) =>
              `The tool name '${tool.name}' is already used by a core tool or another extension.`,
          ),
      ];
      if (problems.length > 0) {
        outcome.state = "invalid";
        for (const message of problems)
          outcome.diagnostics.push({ level: "error", message });
        continue;
      }
      for (const kind of Object.keys(definition.accounts ?? {}))
        kinds.add(kind);
      for (const namespace of definition.namespaces)
        namespaces.add(namespace.id);
      for (const tool of definition.tools ?? []) tools.add(tool.name);
      outcome.state = "enabled";
      accepted.push(scanned);
    }

    const sources = new Map(
      accepted.map((scanned) => [scanned.loaded!.definition, scanned]),
    );
    let registry: QuickScriptRegistry;
    try {
      registry = this.#createRegistry([...sources.keys()], sources);
    } catch (cause) {
      // Every extension was checked alone and against the others; a failure here is a host bug, and it must not take the built-ins down.
      this.#options.warn?.("Extension registry could not be composed", cause);
      for (const scanned of accepted) {
        const outcome = outcomes.get(scanned)!;
        outcome.state = "invalid";
        outcome.diagnostics.push({
          level: "error",
          message: `Could not be registered: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
      registry = this.#createRegistry([], new Map());
    }

    for (const scanned of [...user.values(), ...project.values()]) {
      const outcome = outcomes.get(scanned)!;
      const manifest = scanned.read.manifest;
      entries.push({
        id: manifest?.id ?? scanned.read.folderName,
        source: scanned.source,
        state: outcome.state === "loadable" ? "enabled" : outcome.state,
        path: scanned.read.folder,
        ...(manifest
          ? {
              name: manifest.name,
              description: manifest.description,
              version: manifest.version,
              sdkVersion: manifest.sdkVersion,
            }
          : {}),
        ...(outcome.shadowedBy ? { shadowedBy: outcome.shadowedBy } : {}),
        diagnostics: outcome.diagnostics,
        ...(outcome.state === "pending_consent" && outcome.consent
          ? { consent: outcome.consent }
          : {}),
      });
    }
    const ui: InstalledUiExtension[] = accepted.flatMap((scanned) => {
      const manifest = scanned.read.manifest!;
      return manifest.ui
        ? [
            {
              id: manifest.id,
              name: manifest.name,
              source: scanned.source,
              dist: join(scanned.read.folder, "dist"),
              ui: manifest.ui,
              themes:
                scanned.source === "user"
                  ? (scanned.read.themes ?? []).flatMap((theme) =>
                      "theme" in theme ? [theme.theme] : [],
                    )
                  : [],
            },
          ]
        : [];
    });
    return { registry, entries, ui };
  }

  /** Publishes the direct tools of the installed extensions in `registry` to the tool scope of one project. */
  #publishTools(key: string, registry: QuickScriptRegistry): void {
    const installed = new Set(
      registry.extensions
        .filter((extension) => extension.source !== "builtin")
        .map((extension) => extension.id),
    );
    setScopedToolDefinitions(
      key,
      createExtensionToolDefinitions(registry).filter(
        (definition) =>
          definition.extension !== undefined &&
          installed.has(definition.extension.id),
      ),
    );
    this.#toolScopes.add(key);
  }
}

/** Project directories are keys: compare them by their normalized path. */
function resolveKey(projectDir: string): string {
  return projectDir.length > 1 ? projectDir.replace(/\/+$/, "") : projectDir;
}

export type { ExtensionTrustGate };
