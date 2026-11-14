import type {
  AccountKind,
  ExtensionSettingsDefinition,
  SettingsSchema,
} from "@nervekit/contracts/extensions";
import type {
  Availability,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionPermissions,
  Requires,
  ToolDefinition as ExtensionToolDefinition,
} from "@nervekit/extension-api";
import type { SdkEnvironment, SdkMethod } from "./runtime/sdk-types.js";

/** One `sdk.docs` topic. `id` is the full topic id (`jira/workflows`); `file` is relative to the owner's `docs/` folder. */
export type DocTopic = { id: string; whenToRead: string; file: string };

/**
 * A `quick_script` global namespace contributed by an extension or the runtime.
 * Extensions built on `@nervekit/extension-api` are converted to this shape by `fromDefinition`.
 */
export type SdkNamespace = {
  /** Global name in the sandbox: `jira`. */
  id: string;
  /** Boolean setting key (or any of several) of the extension that switches this namespace (`jira` in Atlassian's settings). Absent: the namespace follows its extension. */
  enabledBy?: string | string[];
  /** Account setting that must select an existing account with a saved secret for the namespace to be available. */
  requires?: Requires;
  /** Sandbox-side helper namespace (no host methods of its own). */
  helper?: boolean;
  /** Extra availability check (extension-API namespaces only). */
  availability?: (
    ctx: ExtensionContext,
  ) => Availability | Promise<Availability>;
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

/**
 * The manifest of a built-in extension as the host registers it. Extensions
 * written against `@nervekit/extension-api` are converted into it
 * (`fromDefinition`); the other built-ins still hand-write it with
 * `contributes.sdk` and `SdkMethod`. LEGACY until extension-platform S2.
 */
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
  /** What the extension may reach: network origins and host capabilities. */
  permissions?: ExtensionPermissions;
  /** Set when the extension is built on `@nervekit/extension-api`; its methods run through `ctx`, not `SdkEnvironment`. */
  definition?: ExtensionDefinition;
  /** Direct tools (extension-API extensions). */
  tools?: readonly ExtensionToolDefinition[];
  /** Sandbox-side helper source appended to the SDK prelude. */
  prelude?: string;
  /** Reads a doc topic file (`DocTopic.file`) of this extension. */
  readDoc: (file: string) => string;
  /** Byte limits the extension enforces, filled into `{{limit:<name>}}` placeholders of its docs and rules. */
  limits?: Readonly<Record<string, number>>;
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
