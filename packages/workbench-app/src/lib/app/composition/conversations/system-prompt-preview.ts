import {
  leadSettingsOverridesSchema,
  type ProfileTarget,
} from "@nervekit/contracts/agent-configuration";
import type { OperationParams } from "@nervekit/contracts/operations";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";

type Pending = Pick<
  PendingConversationState,
  "id" | "projectId" | "config" | "overrides" | "explicitAgentProfile"
>;

/** Capture current sparse choices and context before awaiting the server. */
export function captureSystemPromptPreview(input: {
  pending?: Pending;
  targetProfile?: ProfileTarget;
  conversation?: { id: string; projectId: string };
}):
  | {
      projectId: string;
      sourceId: string;
      params: OperationParams<"conversation.previewSystemPrompt">;
    }
  | undefined {
  if (input.pending) {
    const pending = input.pending;
    if (
      pending.explicitAgentProfile &&
      input.targetProfile?.name !== pending.explicitAgentProfile
    )
      throw new Error("Profile unavailable. Refresh and try again.");
    const { systemPrompt, instructions, workingDirectory } = pending.config;
    return {
      projectId: pending.projectId,
      sourceId: `pending:${pending.id}`,
      params: {
        projectId: pending.projectId,
        config: { systemPrompt, instructions, workingDirectory },
        overrides: leadSettingsOverridesSchema.parse(pending.overrides ?? {}),
        ...(input.targetProfile
          ? { agentProfile: { ...input.targetProfile } }
          : {}),
      },
    };
  }
  if (!input.conversation) return undefined;
  return {
    projectId: input.conversation.projectId,
    sourceId: input.conversation.id,
    params: { conversationId: input.conversation.id },
  };
}
