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
  earliestAvailableSeq: z.number().int().nonnegative().safe(),
});
export type StreamState = z.infer<typeof streamStateSchema>;

export const eventBatchReasonSchema = z.enum([
  "replay",
  "live",
  "snapshot_delta",
]);
export type EventBatchReason = z.infer<typeof eventBatchReasonSchema>;

export const eventBatchDataSchema = z
  .object({
    stream: z.string().min(1),
    batchId: z.string().min(1),
    reason: eventBatchReasonSchema,
    events: z.array(eventEnvelopeSchema),
    firstSeq: z.number().int().positive().safe().nullable(),
    lastSeq: z.number().int().positive().safe().nullable(),
  })
  .strict()
  .superRefine((batch, context) => {
    const { events } = batch;
    if (events.length === 0) {
      if (batch.firstSeq !== null || batch.lastSeq !== null) {
        context.addIssue({
          code: "custom",
          message: "empty event batches must use null firstSeq and lastSeq",
          path: ["firstSeq"],
        });
      }
      return;
    }

    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1] as EventEnvelope;
      const event = events[index] as EventEnvelope;
      if (event.seq !== previous.seq + 1) {
        context.addIssue({
          code: "custom",
          message: "event batch events must use consecutive seq values",
          path: ["events", index, "seq"],
        });
      }
    }

    const first = events[0] as EventEnvelope;
    const last = events[events.length - 1] as EventEnvelope;
    if (batch.firstSeq !== first.seq) {
      context.addIssue({
        code: "custom",
        message: "firstSeq must match the first event seq",
        path: ["firstSeq"],
      });
    }
    if (batch.lastSeq !== last.seq) {
      context.addIssue({
        code: "custom",
        message: "lastSeq must match the last event seq",
        path: ["lastSeq"],
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
