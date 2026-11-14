import type { ExtensionResolution } from "@nervekit/contracts/extensions";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type {
  ExtensionContext,
  ExtensionSettingsService,
} from "../infrastructure/configuration/extensions/extension-settings-service.js";

/**
 * Resolved extension settings for one conversation: user → project → profile
 * → conversation for a lead, the frozen conversation file for a sub-agent.
 */
export function conversationExtensions(options: {
  agents: Pick<AgentConfigurationService, "paths" | "getEffective">;
  extensions: Pick<ExtensionSettingsService, "resolve">;
}) {
  return async (
    conversationId: string | undefined,
    projectId: string,
  ): Promise<ExtensionResolution> => {
    // A conversation that does not exist yet (creation preview) sees user → project.
    if (!conversationId)
      return options.extensions.resolve({ projectId, role: "lead" });
    return options.extensions.resolve(
      await conversationExtensionContext(options.agents, conversationId),
    );
  };
}

/** Context for resolving a conversation's settings: owner, role and applied profile snapshot. */
export async function conversationExtensionContext(
  agents: Pick<AgentConfigurationService, "paths" | "getEffective">,
  conversationId: string,
): Promise<ExtensionContext> {
  const owner = agents.paths.locations.conversationOwner(conversationId);
  const view = await agents.getEffective(conversationId);
  const document =
    view.status === "available"
      ? view.sources.find((source) => source.scope.scope === "conversation")
          ?.document
      : undefined;
  return {
    projectId: owner.projectId,
    conversationId,
    role: owner.role,
    appliedProfile:
      document && "appliedProfile" in document ? document.appliedProfile : null,
  };
}
