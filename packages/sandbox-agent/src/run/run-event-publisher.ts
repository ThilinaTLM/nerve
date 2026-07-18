import type { RunPublicEventIntent } from "@nervekit/contracts";
import type {
  IdempotentRunEventPublisherPort,
  RunNotifyEventPort,
  RunProgressEvent,
} from "@nervekit/host-runtime";
import type { EventOutbox } from "../state/event-outbox.js";

interface IntentScope {
  conversationId?: string;
  agentId?: string;
  runId?: string;
}

function scopeOf(data: unknown): IntentScope {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  return {
    conversationId:
      typeof record.conversationId === "string"
        ? record.conversationId
        : undefined,
    agentId: typeof record.agentId === "string" ? record.agentId : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
  };
}

export class SandboxRunEventPublisher implements IdempotentRunEventPublisherPort {
  constructor(private readonly outbox: EventOutbox) {}

  async publish(
    intent: RunPublicEventIntent,
  ): Promise<{ eventId: string; sequence: number }> {
    if (intent.delivery !== "sequenced") {
      throw new Error(`Run intent ${intent.id} must use sequenced delivery`);
    }
    const scope = scopeOf(intent.data);
    const record = await this.outbox.append({
      id: intent.id,
      type: intent.type,
      data: intent.data,
      ts: intent.occurredAt,
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
    });
    if (!("seq" in record)) {
      throw new Error(
        `Run intent ${intent.id} did not enter the sequenced outbox`,
      );
    }
    return { eventId: record.id, sequence: record.seq };
  }
}

export class SandboxRunNotifyPublisher implements RunNotifyEventPort {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly outbox: EventOutbox) {}

  publish(event: RunProgressEvent): void {
    const scope = scopeOf(event.data);
    this.tail = this.tail
      .then(async () => {
        await this.outbox.append({
          type: event.type,
          data: event.data,
          ts: event.occurredAt,
          conversationId: scope.conversationId,
          agentId: scope.agentId,
          runId: scope.runId,
        });
      })
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.tail;
  }
}
