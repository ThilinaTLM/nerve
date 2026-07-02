import { z } from "zod";
import { sandboxCommandMethodSchema } from "./sandbox.commands.schema.js";
import {
  isoDateTimeSchema,
  sandboxIdSchema,
  sandboxInstanceIdSchema,
} from "./sandbox.common.schema.js";

export const sandboxProtocolVersionSchema = z.literal(1);
export type SandboxProtocolVersion = z.infer<
  typeof sandboxProtocolVersionSchema
>;

export const sandboxProtocolRoleSchema = z.enum(["agent", "controller"]);
export type SandboxProtocolRole = z.infer<typeof sandboxProtocolRoleSchema>;

export const sandboxProtocolCursorSchema = z.object({
  stream: z.string().min(1),
  processedSeq: z.number().int().nonnegative().safe(),
});
export type SandboxProtocolCursor = z.infer<typeof sandboxProtocolCursorSchema>;

export const sandboxProtocolResumeSchema = z.object({
  sessionId: z.string().min(1).optional(),
  cursors: z.array(sandboxProtocolCursorSchema).optional(),
  lastAckedSeq: z.number().int().nonnegative().safe().optional(),
});
export type SandboxProtocolResume = z.infer<typeof sandboxProtocolResumeSchema>;

export const sandboxProtocolHelloSchema = z.object({
  type: z.literal("hello"),
  version: sandboxProtocolVersionSchema.default(1),
  role: z.literal("agent"),
  sandboxId: sandboxIdSchema,
  instanceId: sandboxInstanceIdSchema,
  capabilities: z.array(z.string().min(1)),
  resume: sandboxProtocolResumeSchema.optional(),
});
export type SandboxProtocolHello = z.infer<typeof sandboxProtocolHelloSchema>;

export const sandboxProtocolWelcomeSchema = z.object({
  type: z.literal("welcome"),
  version: sandboxProtocolVersionSchema.default(1),
  accepted: z.literal(true),
  sessionId: z.string().min(1),
  controllerId: z.string().min(1).optional(),
  replay: z
    .object({
      required: z.boolean(),
      fromSeq: z.number().int().nonnegative().safe().optional(),
      cursors: z.array(sandboxProtocolCursorSchema).optional(),
    })
    .optional(),
  heartbeatIntervalMs: z.number().int().positive().safe().optional(),
});
export type SandboxProtocolWelcome = z.infer<
  typeof sandboxProtocolWelcomeSchema
>;

export const sandboxProtocolReadySchema = z.object({
  type: z.literal("ready"),
  sandboxId: sandboxIdSchema.optional(),
  instanceId: sandboxInstanceIdSchema,
  status: z.enum(["ready", "degraded"]).default("ready"),
  cursors: z.array(sandboxProtocolCursorSchema).optional(),
});
export type SandboxProtocolReady = z.infer<typeof sandboxProtocolReadySchema>;

export const sandboxProtocolHeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  ts: isoDateTimeSchema,
  status: z.string().min(1).optional(),
  cursors: z.array(sandboxProtocolCursorSchema).optional(),
});
export type SandboxProtocolHeartbeat = z.infer<
  typeof sandboxProtocolHeartbeatSchema
>;

export const sandboxProtocolEventSchema = z
  .object({
    id: z.string().min(1).optional(),
    seq: z.number().int().positive().safe(),
    ts: isoDateTimeSchema,
    type: z.string().min(1),
    durability: z.enum(["durable", "transient"]).optional(),
    data: z.unknown().optional(),
  })
  .passthrough();
export type SandboxProtocolEvent = z.infer<typeof sandboxProtocolEventSchema>;

export const sandboxProtocolEventBatchSchema = z
  .object({
    type: z.literal("event.batch"),
    batchId: z.string().min(1),
    stream: z.string().min(1).default("sandbox"),
    firstSeq: z.number().int().positive().safe().optional(),
    lastSeq: z.number().int().positive().safe().optional(),
    events: z.array(sandboxProtocolEventSchema).min(1),
    replay: z.boolean().optional(),
  })
  .superRefine((batch, ctx) => {
    const seqs = batch.events.map((event) => event.seq);
    const firstSeq = Math.min(...seqs);
    const lastSeq = Math.max(...seqs);
    if (batch.firstSeq !== undefined && batch.firstSeq !== firstSeq) {
      ctx.addIssue({
        code: "custom",
        path: ["firstSeq"],
        message: "firstSeq must match the minimum event seq",
      });
    }
    if (batch.lastSeq !== undefined && batch.lastSeq !== lastSeq) {
      ctx.addIssue({
        code: "custom",
        path: ["lastSeq"],
        message: "lastSeq must match the maximum event seq",
      });
    }
    const sorted = [...seqs].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] === sorted[index - 1]) {
        ctx.addIssue({
          code: "custom",
          path: ["events"],
          message: "event seq values must be unique within a batch",
        });
        break;
      }
    }
  });
export type SandboxProtocolEventBatch = z.infer<
  typeof sandboxProtocolEventBatchSchema
>;

export const sandboxProtocolAckSchema = z.object({
  type: z.literal("ack"),
  batchId: z.string().min(1).optional(),
  stream: z.string().min(1),
  processedSeq: z.number().int().nonnegative().safe(),
  accepted: z.number().int().nonnegative().safe().optional(),
});
export type SandboxProtocolAck = z.infer<typeof sandboxProtocolAckSchema>;

export const sandboxProtocolRequestSchema = z.object({
  type: z.literal("request"),
  id: z.string().min(1),
  method: sandboxCommandMethodSchema,
  params: z.unknown().optional(),
});
export type SandboxProtocolRequest = z.infer<
  typeof sandboxProtocolRequestSchema
>;

export const sandboxProtocolResponseSchema = z.object({
  type: z.literal("response"),
  id: z.string().min(1),
  result: z.unknown(),
});
export type SandboxProtocolResponse = z.infer<
  typeof sandboxProtocolResponseSchema
>;

export const sandboxProtocolErrorSchema = z.object({
  type: z.literal("error"),
  id: z.string().min(1).optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().optional(),
  }),
});
export type SandboxProtocolError = z.infer<typeof sandboxProtocolErrorSchema>;

export const sandboxProtocolGoodbyeSchema = z.object({
  type: z.literal("goodbye"),
  reason: z.string().min(1).optional(),
  ts: isoDateTimeSchema.optional(),
});
export type SandboxProtocolGoodbye = z.infer<
  typeof sandboxProtocolGoodbyeSchema
>;

export const sandboxProtocolReplayRequestSchema = z.object({
  type: z.literal("replay.request"),
  stream: z.string().min(1).default("sandbox"),
  afterSeq: z.number().int().nonnegative().safe(),
  limit: z.number().int().positive().safe().max(1000).optional(),
});
export type SandboxProtocolReplayRequest = z.infer<
  typeof sandboxProtocolReplayRequestSchema
>;

export const sandboxProtocolReplayResponseSchema = z.object({
  type: z.literal("replay.response"),
  stream: z.string().min(1).default("sandbox"),
  afterSeq: z.number().int().nonnegative().safe(),
  events: z.array(sandboxProtocolEventSchema),
  complete: z.boolean(),
});
export type SandboxProtocolReplayResponse = z.infer<
  typeof sandboxProtocolReplayResponseSchema
>;

export const sandboxProtocolMessageSchema = z.discriminatedUnion("type", [
  sandboxProtocolHelloSchema,
  sandboxProtocolWelcomeSchema,
  sandboxProtocolReadySchema,
  sandboxProtocolHeartbeatSchema,
  sandboxProtocolEventBatchSchema,
  sandboxProtocolAckSchema,
  sandboxProtocolRequestSchema,
  sandboxProtocolResponseSchema,
  sandboxProtocolErrorSchema,
  sandboxProtocolGoodbyeSchema,
  sandboxProtocolReplayRequestSchema,
  sandboxProtocolReplayResponseSchema,
]);
export type SandboxProtocolMessage = z.infer<
  typeof sandboxProtocolMessageSchema
>;
