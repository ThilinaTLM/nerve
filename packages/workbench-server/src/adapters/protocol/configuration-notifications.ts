import { conversationChannelEventSchemas } from "@nervekit/contracts/core";
import type { AgentScope } from "@nervekit/contracts/agent-configuration";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";

/** Internal profile identities include a name; public invalidations carry only scope. */
function publicScope(scope: AgentScope): AgentScope {
  if (scope.scope === "user") return { scope: "user" };
  if (scope.scope === "project")
    return { scope: "project", projectId: scope.projectId };
  return { scope: "conversation", conversationId: scope.conversationId };
}
export function subscribeConfigurationNotifications(
  service: Pick<
    AgentConfigurationService,
    "subscribeHealth" | "subscribeCreation"
  >,
  notify: (type: string, data: unknown) => unknown,
): () => void {
  const agent = service.subscribeHealth((scope) => {
    const data = conversationChannelEventSchemas[
      "agentConfiguration.changed"
    ].parse({ scope: publicScope(scope) });
    void notify("agentConfiguration.changed", data);
  });
  const creation = service.subscribeCreation((scope) => {
    const data = conversationChannelEventSchemas[
      "conversationDefaults.changed"
    ].parse({ scope: publicScope(scope) });
    void notify("conversationDefaults.changed", data);
  });
  return () => {
    agent();
    creation();
  };
}
