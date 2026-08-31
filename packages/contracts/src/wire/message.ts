import { z } from "zod";
import { protocolErrorMessageSchema } from "./errors.js";
import { eventBatchMessageSchema } from "./event-stream.js";
import {
  protocolRequestMessageSchema,
  protocolResponseMessageSchema,
} from "./rpc.js";
import { eventNotifyMessageSchema } from "./notifications.js";
import {
  goodbyeMessageSchema,
  heartbeatMessageSchema,
  helloMessageSchema,
  readyMessageSchema,
  welcomeMessageSchema,
} from "./session.js";
import {
  streamSubscriptionSetMessageSchema,
  streamSubscriptionUpdatedMessageSchema,
} from "./subscriptions.js";

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
  eventNotifyMessageSchema,
  streamSubscriptionSetMessageSchema,
  streamSubscriptionUpdatedMessageSchema,
]);
export type ProtocolV1Message = z.infer<typeof protocolV1MessageSchema>;

export const protocolV1MessageKinds = new Set<string>(
  protocolV1MessageSchema.options.map((schema) => schema.shape.kind.value),
);
