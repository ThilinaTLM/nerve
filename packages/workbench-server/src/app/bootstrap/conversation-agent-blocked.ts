import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";

/** A tool execution blocked because the conversation's own agent.json cannot be used. */
export function conversationAgentBlocked(
  agentConfiguration: AgentConfigurationService,
  conversationId: string,
  code: string,
  pointer = "",
) {
  return {
    kind: "configuration_blocked" as const,
    request: {
      diagnostics: [
        {
          scope: "conversation" as const,
          scopeId: conversationId,
          document: "agent.json",
          path: agentConfiguration.paths.agent({
            scope: "conversation",
            conversationId,
          }),
          code,
          pointer,
          affectedCapability: "tool-execution",
          recoveryChoices: [
            "retry" as const,
            "reload" as const,
            "repair" as const,
          ],
        },
      ],
    },
  };
}
