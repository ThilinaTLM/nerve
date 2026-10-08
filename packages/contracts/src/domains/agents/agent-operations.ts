import {
  approvalRecordSchema,
  executeToolRequestSchema,
  toolCallRecordSchema,
} from "../tools/records.js";
import {
  agentRecordSchema,
  createAgentRequestSchema,
  updateAgentRequestSchema,
} from "./agent.js";
import { queuedPromptRecordSchema, promptImageSchema } from "./prompt.js";
import { conversationEntrySchema } from "../conversations/conversation-state.js";
import { conversationActiveRunSnapshotSchema } from "../conversations/live-state.js";
import { agentActivitySnapshotSchema } from "./agent-obligation.js";
import { subagentTranscriptSnapshotSchema } from "./subagent-transcript.js";
import {
  agentInputRecordSchema,
  agentCompletionSchema,
  effectiveTurnConfigurationSchema,
} from "./agent-blueprint.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();
const agentIdSchema = z.string().startsWith("agent_");
export const agentQueueItemIdSchema = z.union([
  z.string().startsWith("input_"),
  z.string().startsWith("promptq_"),
]);
const queuedPromptIdSchema = agentQueueItemIdSchema;
export const agentQueueItemSchema = z.union([
  agentInputRecordSchema,
  queuedPromptRecordSchema,
]);
export type AgentQueueItem = z.infer<typeof agentQueueItemSchema>;
export const agentPromptQueueListResultSchema = z.object({
  queuedPrompts: z.array(agentQueueItemSchema),
});
export const agentPromptQueueCancelResultSchema = z.object({
  queuedPrompt: agentQueueItemSchema,
});
function validateAgentHistoryPath(
  history: { activeEntryId: string | null; activeEntryIds: string[] },
  context: z.RefinementCtx,
): void {
  const path = history.activeEntryIds;
  if (new Set(path).size !== path.length)
    context.addIssue({
      code: "custom",
      path: ["activeEntryIds"],
      message: "Owner ancestry cannot repeat an entry.",
    });
  if ((path.at(-1) ?? null) !== history.activeEntryId)
    context.addIssue({
      code: "custom",
      path: ["activeEntryId"],
      message:
        "Owner leaf must be the final ancestry ID; empty ancestry has null leaf.",
    });
}

function validateAgentHistorySnapshotOwnership(
  history: {
    agentId: string;
    conversationId: string;
    activeRun?: z.infer<typeof conversationActiveRunSnapshotSchema>;
    activity?: z.infer<typeof agentActivitySnapshotSchema>;
  },
  context: z.RefinementCtx,
): void {
  for (const field of ["activeRun", "activity"] as const) {
    const snapshot = history[field];
    if (!snapshot) continue;
    for (const identity of ["agentId", "conversationId"] as const) {
      if (snapshot[identity] !== history[identity]) {
        context.addIssue({
          code: "custom",
          path: [field, identity],
          message:
            "History runtime snapshot must identify the selected agent and conversation.",
        });
      }
    }
  }
  if (
    history.activeRun &&
    history.activity &&
    history.activity.activeRunId !== history.activeRun.runId
  ) {
    context.addIssue({
      code: "custom",
      path: ["activity", "activeRunId"],
      message:
        "Activity must identify the same run as the supplied active run snapshot.",
    });
  }
}

export const agentHistoryResultSchema = z
  .object({
    entries: z.array(conversationEntrySchema),
    /** Owner model-tree leaf and ordered root-to-leaf ancestry, including hidden structural IDs. */
    activeEntryId: z.string().startsWith("entry_").nullable(),
    activeEntryIds: z.array(z.string().startsWith("entry_")),
    agentId: z.string().startsWith("agent_"),
    conversationId: z.string().startsWith("conv_"),
    toolCalls: z.array(toolCallRecordSchema),
    /** Cursor and live state captured for this owner, without a parent-only endpoint. */
    cursorSeq: z.number().int().nonnegative().safe(),
    activeRun: conversationActiveRunSnapshotSchema.optional(),
    activity: agentActivitySnapshotSchema.optional(),
    latestCompletion: agentCompletionSchema.nullable(),
    effectiveConfiguration: effectiveTurnConfigurationSchema.nullable(),
  })
  .superRefine(validateAgentHistoryPath)
  .superRefine(validateAgentHistorySnapshotOwnership)
  .superRefine((history, context) => {
    if (
      history.latestCompletion &&
      history.latestCompletion.agentId !== history.agentId
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestCompletion", "agentId"],
        message: "Latest completion must belong to the selected agent.",
      });
    }
    if (
      history.effectiveConfiguration &&
      history.effectiveConfiguration.agentId !== history.agentId
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveConfiguration", "agentId"],
        message: "Effective snapshot must belong to the selected agent.",
      });
    }
  });
export type AgentHistoryResult = z.infer<typeof agentHistoryResultSchema>;

const agentIdParamsSchema = z.object({ agentId: agentIdSchema });
const subagentTranscriptParamsSchema = z.object({
  parentAgentId: agentIdSchema,
  childAgentId: agentIdSchema,
});
const agentConfigureParamsSchema = agentIdParamsSchema.merge(
  updateAgentRequestSchema,
);
const agentConfigureResultSchema = z.object({ agent: agentRecordSchema });
const agentPromptQueueParamsSchema = agentIdParamsSchema;
const agentPromptQueueCancelParamsSchema = agentIdParamsSchema.extend({
  queuedPromptId: queuedPromptIdSchema,
});
const agentPromptQueueForcePushResultSchema = z.object({
  accepted: z.literal(true),
  runId: z.string().startsWith("run_"),
  queuedPromptIds: z.array(queuedPromptIdSchema),
});
const agentRequestToolParamsSchema = agentIdParamsSchema.merge(
  executeToolRequestSchema,
);

export const agentsOperationDefinitions = [
  defineOperation(
    "agent.create",
    createAgentRequestSchema,
    z.object({ agent: agentRecordSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.agent.create",
  ),
  defineOperation(
    "agent.list",
    emptyParamsSchema,
    z.object({ agents: z.array(agentRecordSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.agent.list",
  ),
  defineOperation(
    "agent.get",
    agentIdParamsSchema,
    z.object({ agent: agentRecordSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.agent.get",
  ),
  defineOperation(
    "agent.subagentTranscript.get",
    subagentTranscriptParamsSchema,
    z.object({ transcript: subagentTranscriptSnapshotSchema }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.agent.subagentTranscript.get",
  ),
  defineOperation(
    "agent.history.get",
    agentIdParamsSchema,
    agentHistoryResultSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.agent.history.get",
  ),
  defineOperation(
    "agent.stop",
    agentIdParamsSchema,
    z.object({ accepted: z.literal(true), agentId: agentIdSchema }),
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.agent.stop",
  ),
  defineOperation(
    "agent.resume",
    agentIdParamsSchema,
    z.object({ accepted: z.literal(true), agentId: agentIdSchema }),
    "accepted_async",
    "recommended",
    ["workbench_server"] as const,
    "operation.agent.resume",
  ),
  defineOperation(
    "agent.interrupt",
    agentIdParamsSchema.extend({
      text: z.string().min(1),
      images: z.array(promptImageSchema).max(16).optional(),
    }),
    z.object({ accepted: z.literal(true), agentId: agentIdSchema }),
    "accepted_async",
    "recommended",
    ["workbench_server"] as const,
    "operation.agent.interrupt",
  ),
  defineOperation(
    "agent.configure",
    agentConfigureParamsSchema,
    agentConfigureResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.agent.configure",
  ),
  defineOperation(
    "agent.promptQueue.list",
    agentPromptQueueParamsSchema,
    agentPromptQueueListResultSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.agent.promptQueue.list",
  ),
  defineOperation(
    "agent.promptQueue.cancel",
    agentPromptQueueCancelParamsSchema,
    agentPromptQueueCancelResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.agent.promptQueue.cancel",
  ),
  defineOperation(
    "agent.promptQueue.forcePush",
    agentPromptQueueParamsSchema,
    agentPromptQueueForcePushResultSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.agent.promptQueue.forcePush",
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
    ["workbench_server"] as const,
    "operation.agent.requestTool",
  ),
] as const;
