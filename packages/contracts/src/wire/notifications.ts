import { z } from "zod";
import { notifyEventSchema } from "../events/envelope.js";
import { typedMessageSchema } from "./envelope.js";

export const eventNotifyDataSchema = z
  .object({
    events: z.array(notifyEventSchema).min(1),
  })
  .strict();
export type EventNotifyData = z.infer<typeof eventNotifyDataSchema>;

export const eventNotifyMessageSchema = typedMessageSchema(
  "event.notify",
  eventNotifyDataSchema,
);
