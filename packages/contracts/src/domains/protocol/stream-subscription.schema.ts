import { z } from "zod";
import { typedMessageSchema } from "./envelope.schema.js";
import {
  streamCursorSchema,
  streamStateSchema,
} from "./event-stream.schema.js";

const uniqueStreams = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).superRefine((streams, context) => {
    const seen = new Set<string>();
    for (let index = 0; index < streams.length; index += 1) {
      const stream = (streams[index] as { stream: string }).stream;
      if (seen.has(stream)) {
        context.addIssue({
          code: "custom",
          message: "stream subscriptions must not contain duplicate streams",
          path: [index, "stream"],
        });
      }
      seen.add(stream);
    }
  });

export const streamSubscriptionModeSchema = z.enum([
  "live",
  "replay",
  "snapshot_required",
  "unavailable",
]);
export type StreamSubscriptionMode = z.infer<
  typeof streamSubscriptionModeSchema
>;

export const streamSubscriptionSetDataSchema = z
  .object({
    sessionId: z.string().min(1),
    subscriptionId: z.string().min(1),
    streams: uniqueStreams(streamCursorSchema),
  })
  .strict();
export type StreamSubscriptionSetData = z.infer<
  typeof streamSubscriptionSetDataSchema
>;
export const streamSubscriptionSetMessageSchema = typedMessageSchema(
  "stream.subscription.set",
  streamSubscriptionSetDataSchema,
);

export const subscribedStreamStateSchema = streamStateSchema.extend({
  mode: streamSubscriptionModeSchema,
});
export type SubscribedStreamState = z.infer<typeof subscribedStreamStateSchema>;

export const streamSubscriptionUpdatedDataSchema = z
  .object({
    sessionId: z.string().min(1),
    subscriptionId: z.string().min(1),
    accepted: z.boolean(),
    streams: uniqueStreams(subscribedStreamStateSchema),
    reason: z.string().min(1).max(1_024).optional(),
  })
  .strict();
export type StreamSubscriptionUpdatedData = z.infer<
  typeof streamSubscriptionUpdatedDataSchema
>;
export const streamSubscriptionUpdatedMessageSchema = typedMessageSchema(
  "stream.subscription.updated",
  streamSubscriptionUpdatedDataSchema,
);
