import type { Layer } from "@nervekit/contracts/core";
import type {
  ConfigurationResource,
  ConfigurationResourceKind,
} from "@nervekit/contracts/configuration";

/**
 * What a script may ask about and do to Nerve's configuration: see what is in effect, validate
 * hand-edited files and make the host re-read them. It never writes a file and never grants
 * trust; only the user's Settings page does.
 */

export type ConfigurationAgentScope = Layer;

export type ConfigurationAgentResult = {
  resources: ConfigurationResource[];
};

export type ConfigurationListFilter = {
  kind?: ConfigurationResourceKind;
  scope?: ConfigurationResource["scope"];
  state?: ConfigurationResource["state"];
};

/** Where a setting's value comes from. */
export type ConfigurationOrigin = {
  /** `builtin`, `user`, `project`, `conversation`, `recommendation` or `requirement` (of a profile), ... */
  source: string;
  profile?: string;
};

export type ConfigurationDescription = {
  conversationId: string;
  role: "lead" | "child";
  projectDirectory: string;
  /** The Nerve home: `<home>` in the configure-nerve skill. */
  home: string;
  /** Absent while the conversation's configuration cannot be resolved. */
  ruleSet?: { id: string; selectedBy?: ConfigurationOrigin };
  model?: {
    provider: string;
    modelId: string;
    selectedBy?: ConfigurationOrigin;
  };
  /** The applied profile; `requirements` are the settings it locks. */
  profile?: { name: string; source: string; requirements: unknown };
  availableModels: { provider: string; modelId: string }[];
  /** Why the configuration cannot be resolved, when it cannot. */
  problem?: string;
};

/** A tool as permission rules match it. */
export type ConfigurationTool = {
  /** Exact name for `toolNames`. */
  name: string;
  kind: string;
  /** For `toolGroups`. */
  groups: string[];
  /** For `baseRisks`. */
  baseRisk: string;
  /** Argument that `primaryArgument` matches, first that is present. */
  primaryArguments: string[];
  targetKinds: string[];
  /** Extension that contributes the tool; absent for core tools. */
  extension?: string;
};

export type ConfigurationExplanation =
  | {
      decision: "allow" | "prompt" | "deny";
      reason?: string;
      effectiveRisk?: string;
      /** The rule that decided, with its origin; absent when no rule matched. */
      rule?: unknown;
      ruleSetId?: string;
      /** quick_script: the operations found in the script. */
      operations?: unknown;
    }
  /** The policy cannot be evaluated: a permission file or the agent configuration is unusable. */
  | { decision: "blocked"; reason: string };

export interface ConfigurationAgentPort {
  /** The conversation's context: directories, selected rule set, model and applied profile. */
  describe(): Promise<ConfigurationDescription>;
  /** Resources in effect after precedence, from loaded state. */
  list(filter: ConfigurationListFilter): Promise<ConfigurationAgentResult>;
  /** Every tool of this conversation's project as rules match it. */
  tools(): Promise<{ tools: ConfigurationTool[] }>;
  /** What the current policy decides for a call. Never executes it. */
  explain(call: {
    tool: string;
    args: Record<string, unknown>;
  }): Promise<ConfigurationExplanation>;
  /** Validates the scope's files as they are on disk. Activates nothing. Returns resources with a diagnostic. */
  check(scope: ConfigurationAgentScope): Promise<ConfigurationAgentResult>;
  /**
   * Activates the scope's valid files. A file that is invalid on disk never replaces a valid
   * loaded version (`previousVersionActive`). Never grants trust. Returns resources with a diagnostic.
   */
  reload(scope: ConfigurationAgentScope): Promise<ConfigurationAgentResult>;
}
