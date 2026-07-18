import { randomUUID } from "node:crypto";
import {
  notifyEventSchema,
  parsePublicEventEnvelope,
  publicEventDefinition,
  validatePublicEvent,
  type EventEnvelope,
  type NotifyEvent,
} from "@nervekit/contracts";
import type { SandboxEventStore } from "../state/event-store.js";
import type {
  ManagerEvent,
  ManagerEventBus,
  ManagerNotify,
} from "./manager-event-bus.js";
import {
  MANAGER_EVENT_STORE_ID,
  MANAGER_EVENT_STREAM,
  type ManagerLifecycleEventInput,
} from "./manager-events.js";
import { redactManagerEvent } from "./redaction.js";

export type ManagerPublishedEvent = ManagerEvent | ManagerNotify;

/** Serialized sequence owner and writer for the manager stream. */
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
        this.#nextSeq = state.latestSeq + 1;
      });
    await this.#hydrate;
  }

  publish(input: ManagerLifecycleEventInput): Promise<ManagerPublishedEvent> {
    const next = this.#tail
      .catch(() => undefined)
      .then(async () => {
        await this.init();
        return this.#append(input);
      });
    this.#tail = next.catch(() => undefined);
    return next;
  }

  async #append(
    input: ManagerLifecycleEventInput,
  ): Promise<ManagerPublishedEvent> {
    const definition = publicEventDefinition(input.type);
    if (!definition) throw new Error(`Unknown manager event: ${input.type}`);
    const payload = redactManagerEvent({
      ...(isObject(input.payload) ? input.payload : { value: input.payload }),
      sandboxId: input.sandboxId,
    });
    const id = `evt_${randomUUID()}`;
    const ts = input.ts ?? new Date().toISOString();

    if (definition.delivery === "ephemeral") {
      const event = notifyEventSchema.parse({
        id,
        type: input.type,
        ts,
        data: validatePublicEvent(input.type, payload, "sandbox_manager"),
      }) as NotifyEvent<Record<string, unknown>>;
      const notification: ManagerNotify = {
        stream: MANAGER_EVENT_STREAM,
        sandboxId: input.sandboxId,
        event,
      };
      this.bus.notify(notification);
      return notification;
    }

    const envelope = parsePublicEventEnvelope(
      {
        id,
        seq: this.#nextSeq,
        type: input.type,
        ts,
        data: payload,
      },
      "sandbox_manager",
    ) as EventEnvelope<Record<string, unknown>>;
    const inserted = await this.store.append({
      sandboxId: MANAGER_EVENT_STORE_ID,
      id: envelope.id,
      seq: envelope.seq,
      type: envelope.type,
      ts: envelope.ts,
      payload: envelope.data,
    });
    if (!inserted) throw new Error("Manager event was not persisted");

    this.#nextSeq += 1;
    const event: ManagerEvent = {
      stream: MANAGER_EVENT_STREAM,
      sandboxId: input.sandboxId,
      id: envelope.id,
      seq: envelope.seq,
      type: envelope.type,
      ts: envelope.ts,
      payload: envelope.data,
    };
    this.bus.publish(event);
    return event;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
