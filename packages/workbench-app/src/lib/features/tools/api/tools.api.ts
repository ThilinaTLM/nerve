import {
  toolCallDetailsSchema,
  toolCallRecordSchema,
  toolCallResultChunkSchema,
  toolDescriptorSchema,
  type ToolCallDetails,
  type ToolCallRecord,
  type ToolCallResultChunk,
  type ToolDescriptor,
  type ToolInteractionResolution,
} from "@nervekit/contracts/tools";
import { type AgentRecord } from "@nervekit/contracts/agents";
import { type ConversationRecord } from "@nervekit/contracts/conversations";
import { protocolRequest } from "@nervekit/protocol/adapters";
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

export async function getToolCallDetails(
  toolCallId: string,
): Promise<ToolCallDetails> {
  const result = (await protocolRequest("toolCall.get", { toolCallId })).result;
  return toolCallDetailsSchema.parse(result);
}

export async function readToolCallResult(
  toolCallId: string,
  byteOffset: number,
  byteLimit = 64 * 1024,
): Promise<ToolCallResultChunk> {
  const result = (
    await protocolRequest("toolCall.result.read", {
      toolCallId,
      byteOffset,
      byteLimit,
    })
  ).result;
  return toolCallResultChunkSchema.parse(result);
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
  const resolutionRequestId = crypto.randomUUID();
  try {
    const result = (
      await protocolRequest("toolCall.interaction.resolve", {
        toolCallId,
        interactionOrdinal: ordinal,
        expectedRevision: current.revision,
        resolutionRequestId,
        resolution,
      })
    ).result;
    return { ...result, toolCall: toolCallRecordSchema.parse(result.toolCall) };
  } catch (error) {
    // A transport error is not evidence that acceptance rolled back. Read the
    // durable receipt; never issue a second decision under a fresh identity.
    if (resolution.kind === "approval") {
      const accepted = await getToolCall(toolCallId).catch(() => undefined);
      if (
        accepted?.interactions[ordinal]?.resolutionRequestId ===
        resolutionRequestId
      ) {
        return { toolCall: accepted };
      }
    }
    throw error;
  }
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
