import path from "node:path";
import { z } from "zod";
import {
  agentPreferencesSchema,
  childConversationAgentSchema,
  leadConversationAgentSchema,
  conversationDefaultsSchema,
  profileDefinitionSchema,
  configurationDiagnosticSchema,
} from "@nervekit/contracts/agent-configuration";
import { ConfigurationScopePaths } from "../scope-paths.js";
import type {
  DocumentIssue,
  ScopeHealth,
} from "../scoped-store/scoped-document-store.js";

export type PreferenceScope =
  | { scope: "user" }
  | { scope: "project"; projectId: string };
export type AgentScope =
  | PreferenceScope
  | { scope: "conversation"; conversationId: string };
export type AgentDocument =
  | z.infer<typeof agentPreferencesSchema>
  | z.infer<typeof leadConversationAgentSchema>
  | z.infer<typeof childConversationAgentSchema>;
export type CreationPreferences = z.infer<typeof conversationDefaultsSchema>;
export type ProfileDefinition = z.infer<typeof profileDefinitionSchema>;
export type ConfigurationDiagnostic = z.infer<
  typeof configurationDiagnosticSchema
>;
export interface ConversationOwner {
  projectId: string;
  role: "lead" | "child";
}
export interface ConfigurationLocations {
  home: string;
  projectDirectory(projectId: string): string | undefined;
  conversationOwner(conversationId: string): ConversationOwner;
}

export class AgentConfigurationPaths {
  private readonly paths: ConfigurationScopePaths;
  constructor(readonly locations: ConfigurationLocations) {
    this.paths = new ConfigurationScopePaths({
      userConfigPath: path.join(locations.home, "config"),
      conversationsPath: path.join(locations.home, "data", "conversations"),
      projectDirectory: locations.projectDirectory,
      projectOf: (id) => locations.conversationOwner(id).projectId,
    });
  }
  agent(scope: AgentScope): string {
    return this.paths.resolve(scope, "agent.json").path;
  }
  creation(scope: PreferenceScope): string {
    return this.paths.resolve(scope, "conversation-defaults.json").path;
  }
  profiles(scope: PreferenceScope): string {
    if (scope.scope === "user")
      return path.join(this.locations.home, "data", "agent-profiles");
    // Reuse project ownership validation even though catalogs are outside config/.
    return path.join(
      path.dirname(path.dirname(this.creation(scope))),
      "agent-profiles",
    );
  }
  profile(scope: PreferenceScope, name: string): string {
    return path.join(
      this.profiles(scope),
      `${profileDefinitionSchema.shape.name.parse(name)}.json`,
    );
  }
  get summaries(): string {
    return path.join(
      this.locations.home,
      "cache",
      "conversation-agent-summaries.json",
    );
  }
}

export function parserIssues(error: unknown): DocumentIssue[] {
  if (!(error instanceof z.ZodError))
    return [{ code: "invalid-value", pointer: "" }];
  return error.issues.flatMap<DocumentIssue>((issue) => {
    const segments = issue.path.map(String);
    if (issue.code === "unrecognized_keys")
      return issue.keys.map((key) => ({
        code: "unknown-field" as const,
        pointer: pointer([...segments, key]),
      }));
    return [{ code: "invalid-value" as const, pointer: pointer(segments) }];
  });
}
function pointer(parts: readonly string[]): string {
  return parts.length
    ? `/${parts.map((p) => p.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`
    : "";
}

export function diagnostic(
  scope: AgentScope,
  document: string,
  file: string,
  code: string,
  at = "",
  schemaVersion?: number,
): ConfigurationDiagnostic {
  return {
    scope: scope.scope,
    ...(scope.scope === "project"
      ? { scopeId: scope.projectId }
      : scope.scope === "conversation"
        ? { scopeId: scope.conversationId }
        : {}),
    document,
    path: file,
    code,
    pointer: at,
    ...(schemaVersion !== undefined && Number.isSafeInteger(schemaVersion)
      ? { schemaVersion }
      : {}),
    affectedCapability:
      document === "conversation-defaults"
        ? "conversation-creation"
        : document.startsWith("profile:")
          ? "profile-selection"
          : "agent-execution",
    recoveryChoices:
      code === "future-version"
        ? ["upgrade", "reset"]
        : code === "io-error"
          ? ["retry", "reload"]
          : ["reload", "repair", "reset"],
  };
}
export function healthDiagnostics<S extends AgentScope, D>(
  health: ScopeHealth<S, D>,
  document: string,
): ConfigurationDiagnostic[] {
  return health.status === "unavailable"
    ? health.issues.map((issue) =>
        diagnostic(
          health.scope,
          document,
          health.path,
          issue.code,
          issue.pointer,
          health.schemaVersion,
        ),
      )
    : [];
}
