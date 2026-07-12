import type { RunPublicEventIntent } from "@nervekit/contracts";
import type {
  IdempotentRunEventPublisherPort,
  RunProgressEvent,
  RunTransientEventPort,
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

/**
 * Idempotent publication of durable run event intents onto the sandbox
 * EventOutbox. The intent id is the outbox record id, so redelivery after a
 * crash between commit and delivery-marker is a no-op (EventOutbox.append is
 * idempotent by id).
 */
export class SandboxRunEventPublisher implements IdempotentRunEventPublisherPort {
  constructor(private readonly outbox: EventOutbox) {}

  async publish(
    intent: RunPublicEventIntent,
  ): Promise<{ eventId: string; sequence: number }> {
    const scope = scopeOf(intent.data);
    const record = await this.outbox.append({
      id: intent.id,
      type: intent.type,
      durability: intent.durability,
      data: intent.data,
      ts: intent.occurredAt,
      conversationId: scope.conversationId,
      agentId: scope.agentId,
      runId: scope.runId,
    });
    return { eventId: record.id, sequence: record.seq };
  }
}

/**
 * Bounded, non-authoritative transient progress delivered directly to the
 * outbox as a transient record. Never persisted; never part of run state.
 */
export class SandboxRunTransientPublisher implements RunTransientEventPort {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly outbox: EventOutbox) {}

  publish(event: RunProgressEvent): void {
    const scope = scopeOf(event.data);
    this.tail = this.tail
      .then(async () => {
        await this.outbox.append({
          type: event.type,
          durability: "transient",
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
