import { z } from "zod";
import {
  type EventEnvelope,
  eventEnvelopeSchema,
} from "../events/envelope.schema.js";
import { typedMessageSchema } from "./envelope.schema.js";

export const streamCursorSchema = z.object({
  stream: z.string().min(1),
  processedSeq: z.number().int().nonnegative().safe(),
});
export type StreamCursor = z.infer<typeof streamCursorSchema>;

export const streamStateSchema = z.object({
  stream: z.string().min(1),
  latestSeq: z.number().int().nonnegative().safe(),
  durableSeq: z.number().int().nonnegative().safe().optional(),
  replayFromSeq: z.number().int().nonnegative().safe().optional(),
  replayAvailableFromSeq: z.number().int().nonnegative().safe().optional(),
});
export type StreamState = z.infer<typeof streamStateSchema>;

export const eventBatchReasonSchema = z.enum([
  "live",
  "replay",
  "snapshot_delta",
  "catchup",
]);
export type EventBatchReason = z.infer<typeof eventBatchReasonSchema>;

export const skippedNonDurableRangeSchema = z.object({
  fromSeq: z.number().int().nonnegative().safe(),
  toSeq: z.number().int().nonnegative().safe(),
  reason: z.enum([
    "transient_unavailable",
    "transient_dropped",
    "coalesced",
    "not_required",
  ]),
});

export const eventBatchRangeSchema = z.object({
  firstSeq: z.number().int().nonnegative().safe().nullable(),
  lastSeq: z.number().int().nonnegative().safe().nullable(),
  durableFirstSeq: z.number().int().nonnegative().safe().nullable().optional(),
  durableLastSeq: z.number().int().nonnegative().safe().nullable().optional(),
  durableCount: z.number().int().nonnegative().safe(),
  transientCount: z.number().int().nonnegative().safe(),
  previousDurableSeq: z
    .number()
    .int()
    .nonnegative()
    .safe()
    .nullable()
    .optional(),
  durableCompleteThroughSeq: z.number().int().nonnegative().safe().optional(),
  skippedNonDurableRanges: z.array(skippedNonDurableRangeSchema).optional(),
});
export type EventBatchRange = z.infer<typeof eventBatchRangeSchema>;

export const eventBatchDataSchema = z
  .object({
    stream: z.string().min(1),
    batchId: z.string().min(1),
    reason: eventBatchReasonSchema,
    events: z.array(eventEnvelopeSchema),
    range: eventBatchRangeSchema,
    replay: z
      .object({
        replayId: z.string().min(1),
        fromSeq: z.number().int().nonnegative().safe(),
        toSeq: z.number().int().nonnegative().safe().optional(),
        complete: z.boolean().optional(),
      })
      .optional(),
    compression: z
      .object({
        algorithm: z.literal("none"),
      })
      .optional(),
  })
  .superRefine((batch, context) => {
    const { events, range } = batch;
    if (events.length === 0) {
      if (range.firstSeq !== null || range.lastSeq !== null) {
        context.addIssue({
          code: "custom",
          message: "empty event batches must use null firstSeq and lastSeq",
          path: ["range"],
        });
      }
      if (range.durableCount !== 0 || range.transientCount !== 0) {
        context.addIssue({
          code: "custom",
          message: "empty event batches must have zero event counts",
          path: ["range"],
        });
      }
      return;
    }

    const seen = new Set<number>();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index] as EventEnvelope;
      if (seen.has(event.seq)) {
        context.addIssue({
          code: "custom",
          message: "event batch contains duplicate seq values",
          path: ["events", index, "seq"],
        });
      }
      seen.add(event.seq);
      const previous = events[index - 1] as EventEnvelope | undefined;
      if (previous && event.seq <= previous.seq) {
        context.addIssue({
          code: "custom",
          message: "event batch events must be sorted by ascending seq",
          path: ["events", index, "seq"],
        });
      }
    }

    const first = events[0] as EventEnvelope;
    const last = events[events.length - 1] as EventEnvelope;
    if (range.firstSeq !== first.seq || range.lastSeq !== last.seq) {
      context.addIssue({
        code: "custom",
        message: "event batch range must match first and last event seq",
        path: ["range"],
      });
    }

    const durableEvents = events.filter(
      (event) => event.durability === "durable",
    );
    const transientEvents = events.filter(
      (event) => event.durability === "transient",
    );
    if (range.durableCount !== durableEvents.length) {
      context.addIssue({
        code: "custom",
        message: "durableCount does not match events",
        path: ["range", "durableCount"],
      });
    }
    if (range.transientCount !== transientEvents.length) {
      context.addIssue({
        code: "custom",
        message: "transientCount does not match events",
        path: ["range", "transientCount"],
      });
    }

    if (durableEvents.length > 0) {
      const durableFirst = durableEvents[0] as EventEnvelope;
      const durableLast = durableEvents[
        durableEvents.length - 1
      ] as EventEnvelope;
      if (range.durableFirstSeq !== durableFirst.seq) {
        context.addIssue({
          code: "custom",
          message: "durableFirstSeq does not match first durable event",
          path: ["range", "durableFirstSeq"],
        });
      }
      if (range.durableLastSeq !== durableLast.seq) {
        context.addIssue({
          code: "custom",
          message: "durableLastSeq does not match last durable event",
          path: ["range", "durableLastSeq"],
        });
      }
      if (
        range.previousDurableSeq === undefined ||
        range.previousDurableSeq === null
      ) {
        context.addIssue({
          code: "custom",
          message: "durable batches must include previousDurableSeq",
          path: ["range", "previousDurableSeq"],
        });
      }
      if (range.durableCompleteThroughSeq === undefined) {
        context.addIssue({
          code: "custom",
          message: "durable batches must include durableCompleteThroughSeq",
          path: ["range", "durableCompleteThroughSeq"],
        });
      } else if (range.durableCompleteThroughSeq < durableLast.seq) {
        context.addIssue({
          code: "custom",
          message: "durableCompleteThroughSeq must cover durableLastSeq",
          path: ["range", "durableCompleteThroughSeq"],
        });
      }
    } else if (
      range.durableFirstSeq !== undefined &&
      range.durableFirstSeq !== null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "durableFirstSeq must be null or omitted without durable events",
        path: ["range", "durableFirstSeq"],
      });
    }
  });
export type EventBatchData = Omit<
  z.infer<typeof eventBatchDataSchema>,
  "events"
> & {
  events: EventEnvelope[];
};

export const eventBatchMessageSchema = typedMessageSchema(
  "event.batch",
  eventBatchDataSchema,
);
