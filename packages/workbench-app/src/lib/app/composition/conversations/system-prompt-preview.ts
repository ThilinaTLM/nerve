import { conversationConfigSchema } from "@nervekit/contracts/core";
import {
  capabilityOverridesDocumentSchema,
  emptyCapabilityOverrides,
} from "@nervekit/contracts/capabilities";
import { subagentProfilesDocumentSchema } from "@nervekit/contracts/subagents";
import type { OperationParams } from "@nervekit/contracts/operations";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";

type Pending = Pick<
  PendingConversationState,
  | "id"
  | "projectId"
  | "config"
  | "capabilityOverrides"
  | "subagentProfileOverrides"
>;

/** Capture current draft settings before awaiting the server; never use a prior request. */
export function captureSystemPromptPreview(input: {
  pending?: Pending;
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
    return {
      projectId: pending.projectId,
      sourceId: `pending:${pending.id}`,
      params: {
        projectId: pending.projectId,
        config: conversationConfigSchema
          .omit({ conversationId: true })
          .parse(pending.config),
        capabilityOverrides: capabilityOverridesDocumentSchema.parse(
          pending.capabilityOverrides ?? emptyCapabilityOverrides(),
        ),
        ...(pending.subagentProfileOverrides
          ? {
              subagentProfileOverrides: subagentProfilesDocumentSchema.parse(
                pending.subagentProfileOverrides,
              ),
            }
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
