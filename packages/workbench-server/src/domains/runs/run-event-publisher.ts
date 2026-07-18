import type { RunPublicEventIntent } from "@nervekit/contracts";
import type {
  IdempotentRunEventPublisherPort,
  RunProgressEvent,
  RunNotifyEventPort,
} from "@nervekit/host-runtime";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";

export class WorkbenchRunEventPublisher implements IdempotentRunEventPublisherPort {
  constructor(private readonly events: StreamLogRegistry) {}

  async publish(
    intent: RunPublicEventIntent,
  ): Promise<{ eventId: string; sequence: number }> {
    if (intent.delivery !== "sequenced") {
      throw new Error(`Run intent ${intent.id} must use sequenced delivery`);
    }
    const event = await this.events.publishWithId(
      intent.id,
      intent.type,
      intent.data,
    );
    if (!("seq" in event)) {
      throw new Error(
        `Run intent ${intent.id} did not produce a sequenced event`,
      );
    }
    return { eventId: event.id, sequence: event.seq };
  }
}

export class WorkbenchRunNotifyPublisher implements RunNotifyEventPort {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly events: StreamLogRegistry) {}

  publish(event: RunProgressEvent): void {
    this.tail = this.tail
      .then(async () => {
        await this.events.publish(event.type, event.data);
      })
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.tail;
  }
}
