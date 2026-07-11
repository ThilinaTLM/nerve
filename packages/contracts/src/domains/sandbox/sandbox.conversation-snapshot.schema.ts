import { z } from "zod";
import { conversationSnapshotSchema } from "../conversations/index.js";
import {
  isoDateTimeSchema,
  sandboxAgentIdSchema,
  sandboxConversationIdSchema,
  sandboxDaemonStatusSchema,
  sandboxIdSchema,
  sandboxInstanceIdSchema,
  sandboxRunIdSchema,
} from "./sandbox.common.schema.js";
import { sandboxRuntimeContainerStatusSchema } from "./sandbox.manager.schema.js";
import {
  sandboxAgentSnapshotSchema,
  sandboxControllerSessionSummarySchema,
  sandboxConversationSnapshotSchema,
  sandboxManagerStalenessSummarySchema,
  sandboxRunSnapshotSchema,
} from "./sandbox.snapshot.schema.js";

export const sandboxConversationSnapshotGetParamsSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
});
export type SandboxConversationSnapshotGetParams = z.infer<
  typeof sandboxConversationSnapshotGetParamsSchema
>;

export const sandboxConversationViewSnapshotSchema = z.object({
  sandboxId: sandboxIdSchema.optional(),
  instanceId: sandboxInstanceIdSchema.optional(),
  status: sandboxDaemonStatusSchema.optional(),
  connected: z.boolean(),
  stale: z.boolean().optional(),
  staleness: sandboxManagerStalenessSummarySchema.optional(),
  lastEventSeq: z.number().int().nonnegative().safe().optional(),
  lastEventAt: isoDateTimeSchema.optional(),
  lastSession: sandboxControllerSessionSummarySchema.optional(),
  container: sandboxRuntimeContainerStatusSchema.optional(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
  snapshot: conversationSnapshotSchema.optional(),
  fallback: z
    .object({
      conversations: z.array(sandboxConversationSnapshotSchema).optional(),
      agents: z.array(sandboxAgentSnapshotSchema).optional(),
      runs: z.array(sandboxRunSnapshotSchema).optional(),
      readOnly: z.boolean().default(true),
      reason: z.string().min(1).optional(),
    })
    .optional(),
  generatedAt: isoDateTimeSchema,
});
export type SandboxConversationViewSnapshot = z.infer<
  typeof sandboxConversationViewSnapshotSchema
>;
