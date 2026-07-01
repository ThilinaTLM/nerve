import { z } from "zod";
import { typedMessageSchema } from "./envelope.schema.js";

export const flowModeSchema = z.enum([
  "normal",
  "catching_up",
  "degraded",
  "resync_required",
]);
export type FlowMode = z.infer<typeof flowModeSchema>;

export const flowReasonSchema = z.enum([
  "client_backpressure",
  "server_backpressure",
  "transport_buffer_high",
  "ack_lag_high",
  "replay_in_progress",
  "transient_events_dropped",
  "queue_limit_exceeded",
  "snapshot_required",
  "manual",
]);
export type FlowReason = z.infer<typeof flowReasonSchema>;

export const flowUpdateDataSchema = z.object({
  sessionId: z.string().min(1),
  scope: z.object({
    stream: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
    entityId: z.string().min(1).optional(),
  }),
  mode: flowModeSchema,
  reason: flowReasonSchema,
  stats: z
    .object({
      serverQueueEvents: z.number().int().nonnegative().safe().optional(),
      serverQueueBytes: z.number().int().nonnegative().safe().optional(),
      clientPendingEvents: z.number().int().nonnegative().safe().optional(),
      unackedDurableEvents: z.number().int().nonnegative().safe().optional(),
      unackedBytes: z.number().int().nonnegative().safe().optional(),
      droppedTransientEvents: z.number().int().nonnegative().safe().optional(),
      coalescedTransientEvents: z
        .number()
        .int()
        .nonnegative()
        .safe()
        .optional(),
      oldestUnackedSeq: z.number().int().nonnegative().safe().optional(),
      latestSeq: z.number().int().nonnegative().safe().optional(),
      processedSeq: z.number().int().nonnegative().safe().optional(),
    })
    .optional(),
  action: z
    .object({
      type: z.enum([
        "none",
        "reduce_rate",
        "pause_transient",
        "request_replay",
        "load_snapshot",
        "reconnect",
        "close",
      ]),
      retryAfterMs: z.number().int().nonnegative().safe().optional(),
      message: z.string().min(1).optional(),
    })
    .optional(),
});
export type FlowUpdateData = z.infer<typeof flowUpdateDataSchema>;
export const flowUpdateMessageSchema = typedMessageSchema(
  "flow.update",
  flowUpdateDataSchema,
);
