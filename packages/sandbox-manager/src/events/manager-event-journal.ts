import { randomUUID } from "node:crypto";
import {
  parsePublicEventEnvelope,
  publicEventDefinition,
  type EventEnvelope,
} from "@nervekit/contracts";
import type { SandboxEventStore } from "../state/event-store.js";
import type { ManagerEvent, ManagerEventBus } from "./manager-event-bus.js";
import {
  MANAGER_EVENT_STORE_ID,
  MANAGER_EVENT_STREAM,
  type ManagerLifecycleEventInput,
} from "./manager-events.js";
import { redactManagerEvent } from "./redaction.js";

/** Serialized sequence owner and durable writer for the manager event stream. */
export class ManagerEventJournal {
  #nextSeq = 1;
  #hydrate?: Promise<void>;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: SandboxEventStore,
    private readonly bus: ManagerEventBus,
  ) {}

  async init(): Promise<void> {
    this.#hydrate ??= this.store
      .streamState(MANAGER_EVENT_STORE_ID)
      .then((state) => {
        this.#nextSeq = state.durableSeq + 1;
      });
    await this.#hydrate;
  }

  publish(input: ManagerLifecycleEventInput): Promise<ManagerEvent> {
    const next = this.#tail
      .catch(() => undefined)
      .then(async () => {
        await this.init();
        return this.#append(input);
      });
    this.#tail = next.catch(() => undefined);
    return next;
  }

  async #append(input: ManagerLifecycleEventInput): Promise<ManagerEvent> {
    const definition = publicEventDefinition(input.type);
    if (!definition) throw new Error(`Unknown manager event: ${input.type}`);
    const payload = redactManagerEvent({
      ...(isObject(input.payload) ? input.payload : { value: input.payload }),
      sandboxId: input.sandboxId,
    });
    const envelope = parsePublicEventEnvelope(
      {
        id: `evt_${randomUUID()}`,
        seq: this.#nextSeq,
        type: input.type,
        ts: input.ts ?? new Date().toISOString(),
        durability: input.durability ?? definition.durability,
        data: payload,
      },
      "sandbox_manager",
    ) as EventEnvelope<Record<string, unknown>>;

    if (envelope.durability === "durable") {
      const inserted = await this.store.append({
        sandboxId: MANAGER_EVENT_STORE_ID,
        id: envelope.id,
        seq: envelope.seq,
        type: envelope.type,
        ts: envelope.ts,
        durability: envelope.durability,
        payload: envelope.data,
      });
      if (!inserted) throw new Error("Manager event was not persisted");
    }

    this.#nextSeq += 1;
    const event: ManagerEvent = {
      stream: MANAGER_EVENT_STREAM,
      sandboxId: input.sandboxId,
      id: envelope.id,
      seq: envelope.seq,
      type: envelope.type,
      ts: envelope.ts,
      durability: envelope.durability,
      payload: envelope.data,
    };
    this.bus.publish(event);
    return event;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
