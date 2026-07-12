import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import {
  approvalRecordSchema,
  toolCallRecordSchema,
  toolNameSchema,
  toolRiskSchema,
  userQuestionRecordSchema,
} from "./records.schema.js";

const workbenchRoles = ["workbench_server"] as const;
const interactionToolCallSchema = toolCallRecordSchema.omit({
  args: true,
  result: true,
  errorDetails: true,
});

export const toolEventDefinitions = [
  definePublicEvent(
    "approval.updated",
    z.object({
      approval: approvalRecordSchema,
      toolCall: interactionToolCallSchema.optional(),
      note: z.string().max(4_096).optional(),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["approval.id"] },
  ),
  definePublicEvent(
    "userQuestion.updated",
    z.object({
      question: userQuestionRecordSchema,
      toolCall: interactionToolCallSchema.optional(),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["question.id"] },
  ),
  definePublicEvent(
    "policy.evaluated",
    z.object({
      toolCallId: z.string().startsWith("tool_"),
      agentId: z.string().startsWith("agent_"),
      conversationId: z.string().startsWith("conv_"),
      projectId: z.string().startsWith("proj_"),
      toolName: toolNameSchema,
      risk: toolRiskSchema,
      decision: z.enum(["allow", "approval", "deny"]),
      reason: z.string().min(1).max(4_096),
    }),
    { allowedSourceRoles: workbenchRoles, scope: ["toolCallId"] },
  ),
];
