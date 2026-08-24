import {
  toolCallRecordSchema,
  toolDescriptorSchema,
  type AgentRecord,
  type ConversationRecord,
  type ToolCallRecord,
  type ToolDescriptor,
  type ToolInteractionResolution,
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";
import { interactionAddress } from "../state/tool-interaction-projections";
import type { PlanReviewResolveOptions } from "../../../presentation/state/tool-types.js";
export type { PlanReviewResolveOptions } from "../../../presentation/state/tool-types.js";

export async function listTools(): Promise<ToolDescriptor[]> {
  const result = (await protocolRequest("tool.list", {})).result;
  return result.tools.map((tool) => toolDescriptorSchema.parse(tool));
}

export async function getToolCall(toolCallId: string): Promise<ToolCallRecord> {
  const result = (await protocolRequest("toolCall.get", { toolCallId })).result;
  return toolCallRecordSchema.parse(result.toolCall);
}

export async function resolveToolInteraction(
  interactionId: string,
  resolution: ToolInteractionResolution,
): Promise<{
  toolCall: ToolCallRecord;
  effect?: {
    kind: "new_conversation";
    conversation: ConversationRecord;
    agent: AgentRecord;
  };
}> {
  const { toolCallId, ordinal } = interactionAddress(interactionId);
  const current = await getToolCall(toolCallId);
  const result = (
    await protocolRequest("toolCall.interaction.resolve", {
      toolCallId,
      interactionOrdinal: ordinal,
      expectedRevision: current.revision,
      resolutionRequestId: crypto.randomUUID(),
      resolution,
    })
  ).result;
  return { ...result, toolCall: toolCallRecordSchema.parse(result.toolCall) };
}

export function approvalResolution(
  action: "allow" | "deny",
  note?: string,
): ToolInteractionResolution {
  return { kind: "approval", action, note };
}

export function userInputResolution(
  action: "answer" | "dismiss",
  value?: string,
): ToolInteractionResolution {
  return action === "answer"
    ? { kind: "user_input", action, answer: value }
    : { kind: "user_input", action, reason: value };
}

export function planReviewResolution(
  action:
    | "accept"
    | "accept_in_new_chat"
    | "request_changes"
    | "reject"
    | "discard",
  options: PlanReviewResolveOptions = {},
): ToolInteractionResolution {
  return {
    kind: "plan_review",
    action,
    feedback: options.feedback,
    implementationModel: options.implementationModel,
    implementationThinkingLevel: options.implementationThinkingLevel,
    compactBeforeImplementation: options.compactBeforeImplementation,
  };
}
