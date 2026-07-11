import {
  approvalRecordSchema,
  executeToolRequestSchema,
  toolCallRecordSchema,
} from "../tools/index.js";
import {
  agentRecordSchema,
  continueFromFailureRequestSchema,
  createAgentRequestSchema,
  promptRequestSchema,
  queuedPromptRecordSchema,
  updateAgentRequestSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const okResultSchema = z.object({ ok: z.literal(true) });
const agentIdSchema = z.string().startsWith("agent_");
const queuedPromptIdSchema = z.string().startsWith("promptq_");
const agentIdParamsSchema = z.object({ agentId: agentIdSchema });
const agentConfigureParamsSchema = agentIdParamsSchema.merge(
  updateAgentRequestSchema,
);
const agentPromptParamsSchema = agentIdParamsSchema.merge(promptRequestSchema);
const agentPromptQueueParamsSchema = agentIdParamsSchema;
const agentPromptQueueCancelParamsSchema = agentIdParamsSchema.extend({
  queuedPromptId: queuedPromptIdSchema,
});
const agentRequestToolParamsSchema = agentIdParamsSchema.merge(
  executeToolRequestSchema,
);
const agentContinueFromFailureParamsSchema = agentIdParamsSchema.merge(
  continueFromFailureRequestSchema,
);

export const agentsOperationDefinitions = [
  defineOperation(
    "agent.create",
    createAgentRequestSchema,
    z.object({ agent: agentRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.create",
  ),
  defineOperation(
    "agent.list",
    emptyParamsSchema,
    z.object({ agents: z.array(agentRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.list",
  ),
  defineOperation(
    "agent.get",
    agentIdParamsSchema,
    z.object({ agent: agentRecordSchema }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.get",
  ),
  defineOperation(
    "agent.configure",
    agentConfigureParamsSchema,
    z.object({ agent: agentRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.configure",
  ),
  defineOperation(
    "agent.prompt",
    agentPromptParamsSchema,
    okResultSchema,
    "accepted_async",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.prompt",
  ),
  defineOperation(
    "agent.promptQueue.list",
    agentPromptQueueParamsSchema,
    z.object({ queuedPrompts: z.array(queuedPromptRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.promptQueue.list",
  ),
  defineOperation(
    "agent.promptQueue.cancel",
    agentPromptQueueCancelParamsSchema,
    z.object({ queuedPrompt: queuedPromptRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.promptQueue.cancel",
  ),
  defineOperation(
    "agent.requestTool",
    agentRequestToolParamsSchema,
    z.object({
      toolCall: toolCallRecordSchema,
      approval: approvalRecordSchema.optional(),
    }),
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.requestTool",
  ),
  defineOperation(
    "agent.continueFromFailure",
    agentContinueFromFailureParamsSchema,
    okResultSchema,
    "accepted_async",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.continueFromFailure",
  ),
  defineOperation(
    "agent.abort",
    agentIdParamsSchema,
    okResultSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.agent.abort",
  ),
] as const;
