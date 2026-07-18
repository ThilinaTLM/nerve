import assert from "node:assert/strict";
import test from "node:test";
import type {
  RunEventDeliveryRecord,
  RunPublicEventIntent,
  RunTransitionRecord,
} from "@nervekit/contracts";
import {
  RunEventDeliveryService,
  type RunHydratedState,
  type RunUnitOfWorkPort,
} from "../src/index.js";

class DeliveryUnitOfWork implements RunUnitOfWorkPort {
  pending: Array<{
    runId: string;
    revision: number;
    intent: RunPublicEventIntent;
  }> = [];
  deliveries: RunEventDeliveryRecord[] = [];
  pendingScanCalls = 0;
  markerFailures = 0;

  async load(runId: string): Promise<RunHydratedState | undefined> {
    return {
      run: { runId },
      prompts: [],
      interactions: [],
      checkpoints: [],
      transitions: [],
      deliveries: this.deliveries.filter(
        (delivery) => delivery.runId === runId,
      ),
    } as unknown as RunHydratedState;
  }
  async findActive(): Promise<RunHydratedState | undefined> {
    return undefined;
  }
  async listActive(): Promise<readonly RunHydratedState[]> {
    return [];
  }
  async findByInteractionId(): Promise<RunHydratedState | undefined> {
    return undefined;
  }
  async findByInteractionToolCallId(): Promise<RunHydratedState | undefined> {
    return undefined;
  }
  async findByPromptId(): Promise<RunHydratedState | undefined> {
    return undefined;
  }
  async list(): Promise<readonly RunHydratedState[]> {
    return [];
  }
  async commit(): Promise<RunHydratedState> {
    throw new Error("not used");
  }
  async pendingEventIntents() {
    this.pendingScanCalls += 1;
    return this.pending;
  }
  async markEventDelivered(delivery: RunEventDeliveryRecord): Promise<void> {
    if (this.markerFailures > 0) {
      this.markerFailures -= 1;
      throw new Error("marker unavailable");
    }
    const existing = this.deliveries.find(
      (candidate) => candidate.intentId === delivery.intentId,
    );
    if (!existing) this.deliveries.push(delivery);
  }
  async materialize(): Promise<void> {}
}

function intent(id: string, second: number): RunPublicEventIntent {
  return {
    id,
    type: "run.started",
    delivery: "sequenced",
    occurredAt: `2026-07-12T00:00:${String(second).padStart(2, "0")}.000Z`,
    data: {},
  };
}

function transition(
  revision: number,
  events: RunPublicEventIntent[],
): RunTransitionRecord {
  return {
    runId: "run_delivery",
    revision,
    events,
  } as unknown as RunTransitionRecord;
}

test("targeted delivery avoids the all-run pending scan", async () => {
  const unitOfWork = new DeliveryUnitOfWork();
  const historical = intent("intent_historical", 1);
  const current = intent("intent_current", 2);
  unitOfWork.pending = [
    { runId: "run_history", revision: 1, intent: historical },
  ];
  const published: string[] = [];
  const service = new RunEventDeliveryService(
    unitOfWork,
    {
      publish: async (event) => {
        published.push(event.id);
        return { eventId: `event_${event.id}`, sequence: published.length };
      },
    },
    () => "2026-07-12T00:00:20.000Z",
  );

  await service.flushTransition(transition(2, [current]));

  assert.equal(unitOfWork.pendingScanCalls, 0);
  assert.deepEqual(published, ["intent_current"]);
  assert.deepEqual(
    unitOfWork.deliveries.map((delivery) => delivery.intentId),
    ["intent_current"],
  );
});

test("a targeted failure forces a serialized full sweep before later targets", async () => {
  const unitOfWork = new DeliveryUnitOfWork();
  const first = intent("intent_first", 1);
  const second = intent("intent_second", 2);
  const third = intent("intent_third", 3);
  let fail = true;
  const published: string[] = [];
  const service = new RunEventDeliveryService(
    unitOfWork,
    {
      publish: async (event) => {
        published.push(event.id);
        if (fail) {
          fail = false;
          throw new Error("publisher unavailable");
        }
        return { eventId: `event_${event.id}`, sequence: published.length };
      },
    },
    () => "2026-07-12T00:00:20.000Z",
  );

  await assert.rejects(service.flushTransition(transition(1, [first])));
  unitOfWork.pending = [
    { runId: "run_delivery", revision: 1, intent: first },
    { runId: "run_delivery", revision: 2, intent: second },
    { runId: "run_delivery", revision: 3, intent: third },
  ];
  await Promise.all([
    service.flushTransition(transition(2, [second])),
    service.flushTransition(transition(3, [third])),
  ]);

  assert.equal(unitOfWork.pendingScanCalls, 1);
  assert.deepEqual(published, [
    "intent_first",
    "intent_first",
    "intent_second",
    "intent_third",
  ]);
  assert.deepEqual(
    unitOfWork.deliveries.map((delivery) => delivery.intentId),
    ["intent_first", "intent_second", "intent_third"],
  );
});

test("publication success followed by marker failure redelivers idempotently", async () => {
  const unitOfWork = new DeliveryUnitOfWork();
  const current = intent("intent_marker_retry", 1);
  unitOfWork.pending = [
    { runId: "run_delivery", revision: 1, intent: current },
  ];
  unitOfWork.markerFailures = 1;
  const publicationAttempts: string[] = [];
  const published = new Map<string, { eventId: string; sequence: number }>();
  const service = new RunEventDeliveryService(
    unitOfWork,
    {
      publish: async (event) => {
        publicationAttempts.push(event.id);
        const existing = published.get(event.id);
        if (existing) return existing;
        const result = { eventId: `event_${event.id}`, sequence: 1 };
        published.set(event.id, result);
        return result;
      },
    },
    () => "2026-07-12T00:00:20.000Z",
  );

  await assert.rejects(service.flushTransition(transition(1, [current])));
  await service.flushTransition(transition(1, [current]));

  assert.equal(unitOfWork.pendingScanCalls, 1);
  assert.deepEqual(publicationAttempts, [current.id, current.id]);
  assert.equal(published.size, 1);
  assert.equal(unitOfWork.deliveries.length, 1);
});
