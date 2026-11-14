import type {
  AccountKind,
  ExtensionSettingsDefinition,
  SettingsSchema,
} from "@nervekit/contracts/extensions";
import type {
  QuickScriptContext,
  SdkEnvironment,
  SdkMethod,
} from "./runtime/sdk-types.js";

/** One `sdk.docs` topic. `id` is the full topic id (`jira/workflows`); `file` is relative to the owner's `docs/` folder. */
export type DocTopic = { id: string; whenToRead: string; file: string };

/** A `quick_script` global namespace contributed by an extension or the runtime. */
export type SdkNamespace = {
  /** Global name in the sandbox: `jira`. */
  id: string;
  /** Boolean setting key of the extension that switches this namespace (`jira` in Atlassian's settings). Absent: the namespace follows its extension. */
  enabledBy?: string;
  /** One line in the `quick_script` description. */
  summary: string;
  /** At most three short lines, added to the description whenever the namespace is configured. */
  rules?: string[];
  methods: SdkMethod[];
  /** One line `sdk.describe` prints above the declarations: how the namespace is configured now (the backend an extension uses). */
  configuration?: (env: SdkEnvironment) => string | undefined;
  /** Shared declarations for `sdk.describe`: the shapes methods return. */
  types: string;
  docs: DocTopic[];
  /** The global is a function (`image(handle)`) returning a chain whose methods are this namespace's methods. */
  callable?: {
    /** Interface name of the chain. */
    chain: string;
    /** Chain members that are not host methods. */
    steps: string;
    /** The function declaration. */
    declaration: string;
  };
};

/** The parts of `SdkEnvironment` that depend on one extension's connections. */
export type ExtensionEnvironment = Partial<
  Pick<
    SdkEnvironment,
    "jira" | "confluence" | "jiraFields" | "confluenceSpaceKeys"
  >
>;

/** The manifest of a built-in extension (installed extensions come later). */
export type ExtensionManifest = {
  /** Kebab-case, unique, stable. */
  id: string;
  name: string;
  /** One line for the Extensions page. */
  description: string;
  source: "builtin";
  /** Lucide icon name. */
  icon: string;
  /** Default of the implicit `enabled` switch. */
  enabledByDefault: boolean;
  /** Settings the extension offers; the Extensions page is generated from it. */
  settings: SettingsSchema;
  /** Version of `settings`; bump when a field changes meaning. */
  settingsVersion: number;
  /** `migrations[n]` converts version n-1 settings to version n, on read. */
  migrations?: ExtensionSettingsDefinition["migrations"];
  /** Account kinds the extension defines (user-only, credentials in the secret store). */
  accounts?: AccountKind[];
  /** Reads a doc topic file (`DocTopic.file`) of this extension. */
  readDoc: (file: string) => string;
  /** Byte limits the extension enforces, filled into `{{limit:<name>}}` placeholders of its docs and rules. */
  limits?: Readonly<Record<string, number>>;
  /**
   * The extension's part of the per-run environment (connection loaders).
   * TEMPORARY until docs/proposals/extension-platform phase 1 step 3 replaces it with `ctx`.
   */
  createEnvironment?: (context: QuickScriptContext) => ExtensionEnvironment;
  contributes: {
    sdk?: SdkNamespace[];
    /** Direct tool names. */
    tools?: string[];
    /** Skill directories shipped with the extension. */
    skills?: string[];
  };
};

/** Whether a configured namespace can be used now; the same text reaches the agent and, later, the Extensions page. */
export type NamespaceAvailability =
  | { configured: boolean; available: true }
  | {
      configured: boolean;
      available: false;
      /** Why the namespace cannot be used. */
      reason: string;
      /** What the user must do. */
      fix: string;
    };

/** Availability by namespace id, computed by the host from settings. */
export type QuickScriptAvailability = Readonly<
  Record<string, NamespaceAvailability>
>;

/**
 * A namespace as the registry serves it. `builtin` namespaces are quick_script's
 * own capabilities (files, image, libraries, sdk): no settings, always present.
 * `extension` namespaces come from an extension and follow its settings.
 */
export type RegisteredNamespace = SdkNamespace & {
  source: "builtin" | "extension";
  /** Display name of the contributing extension (`Atlassian`); extension namespaces only. */
  extension?: string;
  /** Extension id, or `runtime`. */
  owner: string;
  /** Reads one of this namespace's doc topic files. */
  readDoc: (file: string) => string;
};
