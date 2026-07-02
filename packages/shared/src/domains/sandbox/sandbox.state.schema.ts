import { z } from "zod";
import {
  isoDateTimeSchema,
  sandboxAgentIdSchema,
  sandboxCommandIdSchema,
  sandboxConversationIdSchema,
  sandboxRunIdSchema,
} from "./sandbox.common.schema.js";

export const sandboxOutboxRecordSchema = z.object({
  seq: z.number().int().nonnegative().safe(),
  id: z.string().min(1),
  ts: isoDateTimeSchema,
  type: z.string().min(1),
  durability: z.enum(["durable", "transient"]),
  data: z.unknown(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
  sentAt: isoDateTimeSchema.optional(),
  ackedAt: isoDateTimeSchema.optional(),
});
export type SandboxOutboxRecord = z.infer<typeof sandboxOutboxRecordSchema>;

export const sandboxCommandRecordSchema = z.object({
  commandId: sandboxCommandIdSchema,
  messageId: z.string().min(1),
  method: z.string().min(1),
  paramsHash: z.string().startsWith("sha256:"),
  params: z.unknown(),
  acceptedAt: isoDateTimeSchema,
  status: z.enum([
    "accepted",
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]),
  recoveryStatus: z
    .enum(["not_needed", "requeued", "marked_failed", "marked_cancelled"])
    .optional(),
  conversationId: sandboxConversationIdSchema.optional(),
  agentId: sandboxAgentIdSchema.optional(),
  runId: sandboxRunIdSchema.optional(),
});
export type SandboxCommandRecord = z.infer<typeof sandboxCommandRecordSchema>;

export const sandboxAckStateSchema = z.object({
  streams: z.array(
    z.object({
      stream: z.string().min(1),
      processedSeq: z.number().int().nonnegative().safe(),
    }),
  ),
  updatedAt: isoDateTimeSchema,
});
export type SandboxAckState = z.infer<typeof sandboxAckStateSchema>;

export const sandboxStateLayoutVersionSchema = z.object({
  format: z.literal("nerve-sandbox-state"),
  version: z.literal(1),
  initializedAt: isoDateTimeSchema,
});
export type SandboxStateLayoutVersion = z.infer<
  typeof sandboxStateLayoutVersionSchema
>;
