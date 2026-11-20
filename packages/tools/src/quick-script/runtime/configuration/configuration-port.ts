/**
 * What a script may do to Nerve's configuration files: make the host re-read them and report
 * problems. It never writes a file and never grants trust; only the user's Settings page does.
 */

export type ConfigurationAgentScope = "user" | "project";

export type ConfigurationAgentDiagnostic = {
  scope: "user" | "project";
  /** `agent.json`, `conversation-defaults`, `profile:<name>`, `permissions.json`, `rule-set:<id>` or `launches`. */
  document: string;
  path: string;
  message: string;
  /** `untrusted`: the project file is ignored until the user approves its exact content. */
  trust?: "untrusted";
};

export type ConfigurationAgentResult = {
  diagnostics: ConfigurationAgentDiagnostic[];
};

export interface ConfigurationAgentPort {
  /** Re-reads the scope's configuration from disk and returns its diagnostics; never grants trust. */
  reload(scope: ConfigurationAgentScope): Promise<ConfigurationAgentResult>;
  /** Diagnostics of the scope without re-reading files from disk first. */
  status(scope: ConfigurationAgentScope): Promise<ConfigurationAgentResult>;
}
