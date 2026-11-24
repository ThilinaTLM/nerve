import type { McpScope } from "@nervekit/contracts/mcp";
import type { SecretProvider } from "../../infrastructure/secrets/index.js";

/**
 * Secrets of MCP entries in the credential vault: `mcp:user:<name>` for the user's entries and
 * `mcp:project:<projectId>:<name>` for a project's. An entry reads only its own scope's secrets
 * (a project entry cannot reach the user's by name), and no agent surface returns a value.
 */
export class McpSecrets {
  constructor(private readonly vault: SecretProvider) {}

  static key(scope: McpScope, projectId: string | undefined, name: string) {
    if (scope === "project" && !projectId)
      throw new Error("A project secret needs a project.");
    return scope === "user"
      ? `mcp:user:${name}`
      : `mcp:project:${projectId}:${name}`;
  }

  /** The values of the named secrets; a name with no value is `undefined`. */
  async values(
    scope: McpScope,
    projectId: string | undefined,
    names: readonly string[],
  ): Promise<Record<string, string | undefined>> {
    return Object.fromEntries(
      await Promise.all(
        names.map(
          async (name) =>
            [
              name,
              await this.vault.get(McpSecrets.key(scope, projectId, name)),
            ] as const,
        ),
      ),
    );
  }

  async isSet(scope: McpScope, projectId: string | undefined, name: string) {
    return (
      (await this.vault.get(McpSecrets.key(scope, projectId, name))) !==
      undefined
    );
  }

  set(
    scope: McpScope,
    projectId: string | undefined,
    name: string,
    value: string,
  ) {
    return this.vault.set(McpSecrets.key(scope, projectId, name), value);
  }

  async delete(
    scope: McpScope,
    projectId: string | undefined,
    names: Iterable<string>,
  ) {
    for (const name of names)
      await this.vault.delete(McpSecrets.key(scope, projectId, name));
  }
}
