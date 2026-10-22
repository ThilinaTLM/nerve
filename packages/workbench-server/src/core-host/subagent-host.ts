import type {
  AgentProfileApplication,
  SubagentHost,
  TurnPreparationInput,
} from "@nervekit/conversation-core";
import type { AgentProfileService } from "../domains/agent-profiles/agent-profile.service.js";

export function createSubagentHost(options: {
  profiles: Pick<AgentProfileService, "usable">;
  parent(parentId: string): TurnPreparationInput;
  applicationDefaults(
    projectId: string,
  ): Promise<TurnPreparationInput["config"]>;
  apply(
    input: TurnPreparationInput & { profile: string },
  ): Promise<AgentProfileApplication>;
  validatePermission(ruleSetId: string): Promise<void>;
}): SubagentHost {
  return {
    async usableProfiles(parentId) {
      const parent = options.parent(parentId);
      return (
        await options.profiles.usable({
          projectId: parent.conversation.projectId,
          conversationId: parentId,
          parentConfig: { ...parent.config, conversationId: parentId },
        })
      ).map((profile) => profile.name);
    },
    async resolveProfile({ parentId, profile }) {
      const parent = options.parent(parentId);
      const config = await options.applicationDefaults(
        parent.conversation.projectId,
      );
      const application = await options.apply({
        conversation: {
          projectId: parent.conversation.projectId,
          parentConversationId: parentId,
        },
        config,
        projectDir: parent.projectDir,
        profile,
      });
      await options.validatePermission(
        application.config.permissionRuleSetId ?? config.permissionRuleSetId,
      );
      return { name: application.applied.name, application };
    },
  };
}
