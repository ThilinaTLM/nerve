import { z } from "zod";
import { flowUpdateMessageSchema } from "./backpressure.schema.js";
import { protocolErrorMessageSchema } from "./errors.schema.js";
import { eventBatchMessageSchema } from "./event-stream.schema.js";
import {
  protocolRequestMessageSchema,
  protocolResponseMessageSchema,
} from "./http.schema.js";
import {
  ackMessageSchema,
  replayCompleteMessageSchema,
  replayRequestMessageSchema,
  replayStartedMessageSchema,
  replayUnavailableMessageSchema,
} from "./replay.schema.js";
import {
  goodbyeMessageSchema,
  heartbeatMessageSchema,
  helloMessageSchema,
  readyMessageSchema,
  welcomeMessageSchema,
} from "./session.schema.js";
import {
  streamSubscriptionSetMessageSchema,
  streamSubscriptionUpdatedMessageSchema,
} from "./stream-subscription.schema.js";

export const protocolV1MessageSchema = z.discriminatedUnion("kind", [
  helloMessageSchema,
  welcomeMessageSchema,
  readyMessageSchema,
  heartbeatMessageSchema,
  goodbyeMessageSchema,
  protocolRequestMessageSchema,
  protocolResponseMessageSchema,
  protocolErrorMessageSchema,
  eventBatchMessageSchema,
  ackMessageSchema,
  replayRequestMessageSchema,
  replayStartedMessageSchema,
  replayCompleteMessageSchema,
  replayUnavailableMessageSchema,
  flowUpdateMessageSchema,
  streamSubscriptionSetMessageSchema,
  streamSubscriptionUpdatedMessageSchema,
]);
export type ProtocolV1Message = z.infer<typeof protocolV1MessageSchema>;

export const protocolV1MessageKinds = new Set<string>(
  protocolV1MessageSchema.options.map((schema) => schema.shape.kind.value),
);
