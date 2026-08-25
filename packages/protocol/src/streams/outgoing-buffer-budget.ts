import type { EventEnvelope, NotifyEvent } from "@nervekit/contracts";
import { estimateProtocolMessageBytes } from "./event-batch.js";

export class OutgoingBufferBudget {
  constructor(
    private readonly maxEvents: number,
    private readonly maxBytes: number,
    private readonly onOverflow: (message: string) => void,
  ) {}

  check(
    liveEvents: readonly EventEnvelope[],
    notifications: readonly NotifyEvent[],
  ): boolean {
    const events = liveEvents.length + notifications.length;
    const bytes = liveEvents.reduce(
      (total, event) => total + estimateProtocolMessageBytes("event", event),
      notifications.reduce(
        (total, event) => total + estimateProtocolMessageBytes("notify", event),
        0,
      ),
    );
    if (events <= this.maxEvents && bytes <= this.maxBytes) return true;
    this.onOverflow("Outgoing event buffer exceeded");
    return false;
  }
}
