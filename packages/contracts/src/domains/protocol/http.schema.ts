import { z } from "zod";
import { typedMessageSchema } from "./envelope.schema.js";
import {
  operationNameSchema,
  parseOperationParams,
  parseOperationResult,
  type OperationName,
  type OperationParams,
  type OperationResult,
} from "./operation-catalog.schema.js";
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
export type ProtocolRequestDataFor<M extends OperationName> = Omit<
  ProtocolRequestData,
  "method" | "params"
> & {
  readonly method: M;
  readonly params: OperationParams<M>;
};

export function parseProtocolRequestData(input: unknown): ProtocolRequestData {
  const request = protocolRequestDataSchema.parse(input);
  return {
    ...request,
    params: parseOperationParams(request.method, request.params),
  };
}

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
export type ProtocolResponseDataFor<M extends OperationName> = Omit<
  ProtocolResponseData,
  "method" | "result"
> & {
  readonly method: M;
  readonly result: OperationResult<M>;
};

export function parseProtocolResponseData<M extends OperationName>(
  method: M,
  input: unknown,
): ProtocolResponseDataFor<M> {
  const response = protocolResponseDataSchema.parse(input);
  if (response.method !== method) {
    throw new Error(`Protocol response method did not match ${method}`);
  }
  return {
    ...response,
    method,
    result: parseOperationResult(method, response.result),
  } as ProtocolResponseDataFor<M>;
}

export const protocolResponseMessageSchema = typedMessageSchema(
  "response",
  protocolResponseDataSchema,
);
