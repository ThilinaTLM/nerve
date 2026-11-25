/** Declarations of the `configuration` runtime namespace. */
export const CONFIGURATION_DTS_TYPES = `interface ConfigurationDiagnostic {
  /** "error": the file is not usable. "warning": it loads; read the message. */
  level: "error" | "warning";
  /** Stable, e.g. "malformed-json", "invalid-value", "unknown-field", "needs-review", "declined". */
  code: string;
  /** What is wrong and what to do. */
  message: string;
  /** Where in the file (JSON pointer), when known. */
  pointer?: string;
}
interface ConfigurationResource {
  kind: "agent-preferences" | "agent-profile" | "rule-set" | "permission-overlay" | "launch-catalog" | "skill" | "prompt-suggestion" | "extension";
  /** Name within the kind, e.g. a profile name, a rule set id, "agent.json", "permissions.json". */
  id: string;
  scope: "builtin" | "user" | "project" | "conversation";
  path?: string;
  /** "invalid": not in use, fix it. "needs_review": valid but ignored until the user approves it; you cannot approve. "declined": the user declined it; mention it only if it matters for the task. */
  state: "active" | "disabled" | "shadowed" | "invalid" | "incompatible" | "needs_review" | "declined";
  /** Where the user approves it. Tell them. */
  approval?: { kind: "trust" | "consent"; where: string };
  shadowedBy?: "builtin" | "user" | "project";
  /** The file on disk is invalid, so the version loaded before your edit stays in use. Nothing is broken yet; fix the file and reload. */
  previousVersionActive?: true;
  diagnostics: ConfigurationDiagnostic[];
}
interface ConfigurationResult {
  resources: ConfigurationResource[];
}
interface ConfigurationOrigin {
  /** "builtin", "user", "project", "conversation", or a profile's "recommendation" / "requirement". */
  source: string;
  profile?: string;
}
interface ConfigurationDescription {
  conversationId: string;
  role: "lead" | "child";
  projectDirectory: string;
  /** The Nerve home: <home> in the configure-nerve skill. */
  home: string;
  /** The rule set deciding this conversation's tool calls. Overlays apply only to it. */
  ruleSet?: { id: string; selectedBy?: ConfigurationOrigin };
  model?: { provider: string; modelId: string; selectedBy?: ConfigurationOrigin };
  /** The applied profile. Its requirements win over every file. */
  profile?: { name: string; source: string; requirements: unknown };
  /** Values valid for a \`model\` setting. */
  availableModels: { provider: string; modelId: string }[];
  problem?: string;
}
interface ConfigurationTool {
  /** Exact, case-sensitive name for a rule's toolNames. */
  name: string;
  kind: string;
  /** For toolGroups. */
  groups: string[];
  /** For baseRisks. "unknown": the risk depends on the arguments. */
  baseRisk: string;
  /** What primaryArgument matches: the first of these arguments that is present. */
  primaryArguments: string[];
  targetKinds: string[];
  extension?: string;
}
interface ConfigurationExplanation {
  /** "blocked": the policy cannot be evaluated; see reason. */
  decision: "allow" | "prompt" | "deny" | "blocked";
  reason?: string;
  effectiveRisk?: string;
  /** The rule that decided, with where it comes from. */
  rule?: unknown;
  ruleSetId?: string;
  operations?: unknown;
}`;
