import type { EventEnvelope } from "@nervekit/contracts/events";

/** A `project.created` envelope with a dense id and a fixed timestamp. */
export const event = (
  seq: number,
  data: Record<string, unknown> = {},
): EventEnvelope =>
  ({
    seq,
    id: `evt_${seq}`,
    ts: "2026-07-18T00:00:00.000Z",
    type: "project.created",
    data,
  }) as EventEnvelope;
