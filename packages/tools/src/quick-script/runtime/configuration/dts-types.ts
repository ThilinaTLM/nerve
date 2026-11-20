/** Declarations of the `configuration` runtime namespace. */
export const CONFIGURATION_DTS_TYPES = `interface ConfigurationDiagnostic {
  /** "error": the file is not usable. "warning": it loads; read the message. */
  level: "error" | "warning";
  /** Stable, e.g. "malformed-json", "invalid-value", "unknown-field", "untrusted". */
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
  /** "invalid": not in use, fix it. "needs_approval": valid but ignored until the user approves it; you cannot approve. */
  state: "active" | "disabled" | "shadowed" | "invalid" | "incompatible" | "needs_approval";
  /** Where the user approves it. Tell them. */
  approval?: { kind: "trust" | "consent"; where: string };
  shadowedBy?: "builtin" | "user" | "project";
  /** The file on disk is invalid, so the version loaded before your edit stays in use. Nothing is broken yet; fix the file and reload. */
  previousVersionActive?: true;
  diagnostics: ConfigurationDiagnostic[];
}
interface ConfigurationResult {
  /** Only resources with a diagnostic. Empty means every file of the scope is valid. */
  resources: ConfigurationResource[];
}`;
