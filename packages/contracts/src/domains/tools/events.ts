import { z } from "zod";
import { toolRiskSchema } from "../permissions/index.js";
import { definePublicEvent } from "../../events/definition.js";
import { toolNameSchema } from "./records.js";

export const toolEventDefinitions = [
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
    {
      allowedSourceRoles: ["workbench_server"] as const,
      scope: ["toolCallId"],
    },
  ),
];
