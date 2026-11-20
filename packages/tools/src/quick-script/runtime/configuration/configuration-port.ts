import type { ConfigurationResource } from "@nervekit/contracts/configuration";

/**
 * What a script may do to Nerve's configuration files: validate them and make the host re-read
 * them. It never writes a file and never grants trust; only the user's Settings page does.
 */

export type ConfigurationAgentScope = "user" | "project";

export type ConfigurationAgentResult = {
  /** Every resource of the scope that has a diagnostic; empty when all is well. */
  resources: ConfigurationResource[];
};

export interface ConfigurationAgentPort {
  /** Validates the scope's files as they are on disk. Activates nothing. */
  check(scope: ConfigurationAgentScope): Promise<ConfigurationAgentResult>;
  /**
   * Activates the scope's valid files. A file that is invalid on disk never replaces a valid
   * loaded version (`previousVersionActive`). Never grants trust.
   */
  reload(scope: ConfigurationAgentScope): Promise<ConfigurationAgentResult>;
}
