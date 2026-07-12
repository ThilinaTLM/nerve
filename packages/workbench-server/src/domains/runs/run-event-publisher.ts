import type { RunPublicEventIntent } from "@nervekit/contracts";
import type {
  IdempotentRunEventPublisherPort,
  RunProgressEvent,
  RunTransientEventPort,
} from "@nervekit/host-runtime";
import type { EventBus } from "../../infrastructure/events/index.js";

export class WorkbenchRunEventPublisher
  implements IdempotentRunEventPublisherPort
{
  constructor(private readonly events: EventBus) {}

  async publish(
    intent: RunPublicEventIntent,
  ): Promise<{ eventId: string; sequence: number }> {
    const event = await this.events.publishWithId(
      intent.id,
      intent.type,
      intent.data,
      { durability: intent.durability },
    );
    return { eventId: event.id, sequence: event.seq };
  }
}

export class WorkbenchRunTransientPublisher implements RunTransientEventPort {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly events: EventBus) {}

  publish(event: RunProgressEvent): void {
    this.tail = this.tail
      .then(async () => {
        await this.events.publish(event.type, event.data, {
          durability: "transient",
        });
      })
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.tail;
  }
}
