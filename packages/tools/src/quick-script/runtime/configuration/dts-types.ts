/** Declarations of the `configuration` runtime namespace. */
export const CONFIGURATION_DTS_TYPES = `interface ConfigurationDiagnostic {
  scope: "user" | "project";
  /** "agent.json", "conversation-defaults", "profile:<name>", "permissions.json", "rule-set:<id>" or "launches". */
  document: string;
  path: string;
  message: string;
  /** "untrusted": the project file is ignored until the user approves its exact content in Settings → This project → Trust. */
  trust?: "untrusted";
}
interface ConfigurationResult {
  /** Empty when every file of the scope loads cleanly. */
  diagnostics: ConfigurationDiagnostic[];
}`;
