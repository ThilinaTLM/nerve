import { join } from "node:path";

export type ConfigurationScopeInput = {
  scope: "user" | "project" | "conversation";
  projectId?: string | undefined;
  conversationId?: string | undefined;
};

export type ConfigurationScopePath = {
  path: string;
  /** Boundary used by domain-owned filesystem protection. */
  root: string;
  projectId?: string;
  conversationId?: string;
};

export function userConfigurationRoot(home: string): string {
  return join(home, "config");
}

export function projectConfigurationRoot(projectDirectory: string): string {
  return join(projectDirectory, ".nerve", "config");
}

function assertSegment(value: string, label: string): void {
  if (
    !value ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value === "." ||
    value === ".."
  )
    throw new Error(`Invalid ${label}.`);
}

/** Host scope locations only: schemas, trust and filesystem protection remain with owners. */
export class ConfigurationScopePaths {
  constructor(
    private readonly options: {
      userConfigPath?: string;
      conversationsPath?: string;
      projectDirectory?: (projectId: string) => string | undefined;
      projectOf?: (conversationId: string) => string;
    },
  ) {}

  resolve(
    input: ConfigurationScopeInput,
    filename: string,
  ): ConfigurationScopePath {
    assertSegment(filename, "configuration filename");
    let projectId = input.projectId;
    if (input.conversationId !== undefined) {
      // Conversation IDs are identifiers, never relative paths.
      if (!/^[a-zA-Z0-9_-]+$/.test(input.conversationId))
        throw new Error("Invalid conversation id.");
      if (!this.options.projectOf)
        throw new Error("Conversation ownership resolver is required.");
      const owner = this.options.projectOf(input.conversationId);
      if (!owner) throw new Error("Conversation not found");
      if (projectId && owner !== projectId)
        throw new Error("Conversation does not belong to project");
      projectId = owner;
    }
    if (input.scope === "user") {
      const root = this.options.userConfigPath;
      if (!root) throw new Error("User configuration root is required.");
      return { path: join(root, filename), root };
    }
    if (!projectId) throw new Error("A project is required for this scope.");
    if (input.scope === "project") {
      const directory = this.options.projectDirectory?.(projectId);
      if (!directory) throw new Error(`Project not found: ${projectId}`);
      return {
        path: join(projectConfigurationRoot(directory), filename),
        root: directory,
        projectId,
      };
    }
    if (!input.conversationId)
      throw new Error("A conversation is required for conversation scope.");
    const root = this.options.conversationsPath;
    if (!root) throw new Error("Conversation configuration root is required.");
    return {
      path: join(root, input.conversationId, "config", filename),
      root,
      projectId,
      conversationId: input.conversationId,
    };
  }
}
