/** Declarations of the `configuration` runtime namespace. */
export const CONFIGURATION_DTS_TYPES = `interface ConfigurationDiagnostic {
  scope: "user" | "project";
  /** "agent.json", "conversation-defaults", "profile:<name>", "permissions.json", "rule-set:<id>" or "launches". */
  document: string;
  path: string;
  /** "error": the file is not in use. "warning": it loads; check the message. */
  level: "error" | "warning";
  /** Stable. "untrusted": the project file is ignored until the user approves its exact content in Settings → This project → Trust. */
  code: string;
  message: string;
  /** Where in the file, when known. */
  pointer?: string;
}
interface ConfigurationResult {
  /** Empty when every file of the scope loads cleanly. */
  diagnostics: ConfigurationDiagnostic[];
}`;
