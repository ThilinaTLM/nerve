import type { ConfigurationDiagnostic } from "../infrastructure/configuration/agent-configuration/document-adapters.js";
import { dirname, join } from "node:path";
import type { ConversationCore } from "@nervekit/conversation-core";
import type {
  ScopedConfigurationTarget,
  AgentScope,
} from "@nervekit/contracts/agent-configuration";
import type { ToolCall } from "@nervekit/contracts/core";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { ScopedPermissionPolicySource } from "./scoped-permission-source.js";

export function createConfigurationReload(
  service: AgentConfigurationService,
  policy: Pick<ScopedPermissionPolicySource, "reload">,
) {
  async function target(input: ScopedConfigurationTarget) {
    if (input.document === "agent") await service.reload(input.scope);
    else if (input.document === "profile")
      await service.profiles.reload(input.scope, input.name);
    else await service.reloadCreation(input.scope);
    return service
      .health()
      .filter(
        (issue) =>
          issue.scope === input.scope.scope &&
          (input.scope.scope === "user" ||
            issue.scopeId ===
              (input.scope.scope === "project"
                ? input.scope.projectId
                : input.scope.conversationId)),
      );
  }
  async function retry(
    conversationId: string,
    issues: readonly ConfigurationDiagnostic[],
  ) {
    const policies = new Set<string>();
    const targets = new Map<string, ScopedConfigurationTarget>();
    for (const issue of issues) {
      const scope: AgentScope =
        issue.scope === "user"
          ? { scope: "user" }
          : issue.scope === "project"
            ? {
                scope: "project",
                projectId:
                  issue.scopeId ??
                  service.paths.locations.conversationOwner(conversationId)
                    .projectId,
              }
            : {
                scope: "conversation",
                conversationId: issue.scopeId ?? conversationId,
              };
      let document: ScopedConfigurationTarget | undefined;
      if (issue.document === "agent") document = { document: "agent", scope };
      else if (
        scope.scope !== "conversation" &&
        issue.document === "conversation-defaults"
      )
        document = { document: "conversation-defaults", scope };
      else if (
        scope.scope !== "conversation" &&
        issue.document.startsWith("profile:")
      )
        document = {
          document: "profile",
          scope,
          name: issue.document.slice("profile:".length),
        };
      else if (issue.document === "permissions.json")
        policies.add(
          join(dirname(service.paths.agent(scope)), "permissions.json"),
        );
      else {
        const rules = join(service.paths.locations.home, "config", "rule-sets");
        if (issue.path === rules || dirname(issue.path) === rules)
          policies.add(issue.path);
      }
      if (document) targets.set(JSON.stringify(document), document);
    }
    for (const document of targets.values()) await target(document);
    if (policies.size) await policy.reload([...policies]);
  }
  return { target, retry };
}

/** Retry is explicit disk activation, never an approval. Background retries remain memory-only. */
export async function resolveWithConfigurationRetry(
  input: Parameters<ConversationCore["resolveInteraction"]>[0],
  ports: {
    lookup(id: string): ToolCall | undefined;
    reload(
      conversationId: string,
      issues: readonly ConfigurationDiagnostic[],
    ): Promise<void>;
    resolve: ConversationCore["resolveInteraction"];
  },
): ReturnType<ConversationCore["resolveInteraction"]> {
  const pending = ports.lookup(input.toolCallId);
  if (
    input.resolution.kind === "configuration_blocked" &&
    input.resolution.decision === "retry" &&
    pending?.interaction?.kind === "configuration_blocked"
  ) {
    await ports.reload(
      pending.conversationId,
      pending.interaction.request.diagnostics,
    );
    // Publication observers may already have retried or settled this exact call.
    if (
      ports.lookup(input.toolCallId)?.interaction?.kind !==
      "configuration_blocked"
    )
      return { status: "resolved" };
  }
  return ports.resolve(input);
}
