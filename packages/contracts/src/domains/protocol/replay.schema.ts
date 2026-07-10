import { z } from "zod";
import { typedMessageSchema } from "./envelope.schema.js";
import {
  eventBatchDataSchema,
  streamCursorSchema,
} from "./event-stream.schema.js";

export const ackDataSchema = z.object({
  sessionId: z.string().min(1),
  ackId: z.string().min(1),
  streams: z.array(streamCursorSchema).min(1),
  received: z
    .array(
      z.object({
        stream: z.string().min(1),
        highestSeq: z.number().int().nonnegative().safe(),
      }),
    )
    .optional(),
  stats: z
    .object({
      appliedEvents: z.number().int().nonnegative().safe().optional(),
      duplicateEvents: z.number().int().nonnegative().safe().optional(),
      droppedTransientEvents: z.number().int().nonnegative().safe().optional(),
      pendingEvents: z.number().int().nonnegative().safe().optional(),
      processingLatencyMs: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type AckData = z.infer<typeof ackDataSchema>;
export const ackMessageSchema = typedMessageSchema("event.ack", ackDataSchema);

export const replayRequestDataSchema = z.object({
  sessionId: z.string().min(1),
  replayId: z.string().min(1),
  streams: z.array(
    z.object({
      stream: z.string().min(1),
      fromSeq: z.number().int().nonnegative().safe(),
      toSeq: z.number().int().nonnegative().safe().optional(),
    }),
  ),
  reason: z.enum([
    "resume",
    "gap_detected",
    "client_recovery",
    "snapshot_delta",
    "manual_refresh",
  ]),
  preferences: z
    .object({
      maxEvents: z.number().int().positive().safe().optional(),
      maxBytes: z.number().int().positive().safe().optional(),
      preferSnapshot: z.boolean().optional(),
      includeTransientIfAvailable: z.boolean().optional(),
    })
    .optional(),
});
export type ReplayRequestData = z.infer<typeof replayRequestDataSchema>;
export const replayRequestMessageSchema = typedMessageSchema(
  "replay.request",
  replayRequestDataSchema,
);

export const replayStartedDataSchema = z.object({
  sessionId: z.string().min(1),
  replayId: z.string().min(1),
  streams: z.array(
    z.object({
      stream: z.string().min(1),
      fromSeq: z.number().int().nonnegative().safe(),
      toSeq: z.number().int().nonnegative().safe(),
      latestSeq: z.number().int().nonnegative().safe(),
      durableFromSeq: z.number().int().nonnegative().safe().optional(),
      durableToSeq: z.number().int().nonnegative().safe().optional(),
      estimatedEvents: z.number().int().nonnegative().safe().optional(),
      source: z.enum(["memory", "index", "log", "snapshot", "mixed"]),
      transientPolicy: z
        .enum(["included_if_available", "omitted", "coalesced"])
        .optional(),
    }),
  ),
});
export type ReplayStartedData = z.infer<typeof replayStartedDataSchema>;
export const replayStartedMessageSchema = typedMessageSchema(
  "replay.started",
  replayStartedDataSchema,
);

export const replayCompleteDataSchema = z.object({
  sessionId: z.string().min(1),
  replayId: z.string().min(1),
  streams: z.array(
    z.object({
      stream: z.string().min(1),
      fromSeq: z.number().int().nonnegative().safe(),
      toSeq: z.number().int().nonnegative().safe(),
      latestSeq: z.number().int().nonnegative().safe(),
      durableCompleteThroughSeq: z.number().int().nonnegative().safe(),
      sentEvents: z.number().int().nonnegative().safe(),
      sentDurableEvents: z.number().int().nonnegative().safe(),
      sentTransientEvents: z.number().int().nonnegative().safe(),
      omittedTransientRanges: z
        .array(
          z.object({
            fromSeq: z.number().int().nonnegative().safe(),
            toSeq: z.number().int().nonnegative().safe(),
            reason: z.enum([
              "unavailable",
              "dropped",
              "coalesced",
              "not_required",
            ]),
          }),
        )
        .optional(),
    }),
  ),
  liveDelivery: z.enum(["continued", "resuming", "requires_ready"]),
});
export type ReplayCompleteData = z.infer<typeof replayCompleteDataSchema>;
export const replayCompleteMessageSchema = typedMessageSchema(
  "replay.complete",
  replayCompleteDataSchema,
);

export const replayUnavailableDataSchema = z.object({
  sessionId: z.string().min(1),
  replayId: z.string().min(1),
  streams: z.array(
    z.object({
      stream: z.string().min(1),
      requestedFromSeq: z.number().int().nonnegative().safe(),
      earliestAvailableSeq: z.number().int().nonnegative().safe().optional(),
      latestSeq: z.number().int().nonnegative().safe(),
      reason: z.enum([
        "cursor_too_old",
        "cursor_ahead_of_server",
        "stream_not_found",
        "storage_unavailable",
        "range_too_large",
        "snapshot_required",
      ]),
    }),
  ),
  recovery: z.object({
    action: z.enum(["load_snapshot", "full_reload", "retry_later", "fail"]),
    retryAfterMs: z.number().int().nonnegative().safe().optional(),
    snapshotMethod: z.string().min(1).optional(),
  }),
});
export type ReplayUnavailableData = z.infer<typeof replayUnavailableDataSchema>;
export const replayUnavailableMessageSchema = typedMessageSchema(
  "replay.unavailable",
  replayUnavailableDataSchema,
);

export const replayResponseWithBatchesSchema = z.array(eventBatchDataSchema);
