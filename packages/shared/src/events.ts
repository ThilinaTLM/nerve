import { z } from "zod";

export type EventDurability = "durable" | "transient";

export const eventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  id: z.string().startsWith("evt_"),
  ts: z.string().datetime(),
  type: z.string().min(1),
  durability: z.enum(["durable", "transient"]).default("durable"),
  data: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  "data"
> & {
  data: T;
};
