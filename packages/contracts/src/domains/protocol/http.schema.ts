import { z } from "zod";
import { typedMessageSchema } from "./envelope.schema.js";
import { operationNameSchema } from "./operation-catalog.schema.js";
import {
  eventBatchDataSchema,
  streamCursorSchema,
} from "./event-stream.schema.js";

export const protocolRequestDataSchema = z.object({
  method: operationNameSchema,
  params: z.unknown().optional(),
  idempotencyKey: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().safe().optional(),
  expect: z
    .object({
      response: z.enum(["single", "stream", "accepted"]).optional(),
      events: z.boolean().optional(),
    })
    .optional(),
});
export type ProtocolRequestData = z.infer<typeof protocolRequestDataSchema>;
export const protocolRequestMessageSchema = typedMessageSchema(
  "request",
  protocolRequestDataSchema,
);

export const protocolResponseDataSchema = z.object({
  ok: z.literal(true),
  method: operationNameSchema,
  result: z.unknown(),
  cursor: z
    .object({
      streams: z.array(streamCursorSchema),
    })
    .optional(),
  eventBatches: z.array(eventBatchDataSchema).optional(),
});
export type ProtocolResponseData = z.infer<typeof protocolResponseDataSchema>;
export const protocolResponseMessageSchema = typedMessageSchema(
  "response",
  protocolResponseDataSchema,
);
