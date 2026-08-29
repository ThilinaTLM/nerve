import { z } from "zod";

export const eventEnvelopeSchema = z
  .object({
    seq: z.number().int().positive().safe(),
    id: z.string().startsWith("evt_"),
    ts: z.string().datetime(),
    type: z.string().min(1),
    data: z.unknown(),
  })
  .strict();

export const notifyEventSchema = eventEnvelopeSchema
  .omit({ seq: true })
  .strict();
export type NotifyEvent<T = unknown> = Omit<
  z.infer<typeof notifyEventSchema>,
  "data"
> & {
  data: T;
};
export type EventEnvelope<T = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  "data"
> & {
  data: T;
};
