import type { SdkMethod } from "../sdk-types.js";

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

/** The manifest of a built-in extension (installed extensions come later). The settings schema joins it with the extension settings step. */
export type ExtensionManifest = {
  /** Kebab-case, unique, stable. */
  id: string;
  name: string;
  /** One line for the Extensions page. */
  description: string;
  source: "builtin";
  /** Lucide icon name. */
  icon: string;
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

/** A namespace as the registry serves it: where it comes from and which docs folder owns its topics. */
export type RegisteredNamespace = SdkNamespace & {
  source: "builtin" | "runtime";
  /** Extension id, or `runtime`; names the docs folder. */
  owner: string;
};
