import { randomUUID } from "node:crypto";
import {
  parsePublicEventEnvelope,
  publicEventDefinition,
} from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";
import { redactManagerEvent } from "./redaction.js";

export const MANAGER_EVENT_STORE_ID = "__manager__";
export const MANAGER_EVENT_STREAM = "manager";

export type ManagerLifecycleEventInput = {
  type: string;
  sandboxId?: string;
  payload?: unknown;
  durability?: "durable" | "transient";
};

export async function recordManagerLifecycleEvent(
  state: ManagerState,
  event: ManagerLifecycleEventInput,
): Promise<void> {
  await appendAndPublish(
    state,
    MANAGER_EVENT_STORE_ID,
    MANAGER_EVENT_STREAM,
    event,
  );
}

async function appendAndPublish(
  state: ManagerState,
  storeId: string,
  stream: string,
  event: ManagerLifecycleEventInput,
): Promise<void> {
  const ts = new Date().toISOString();
  const seq = nextSeq(await state.events.list(storeId));
  const definition = publicEventDefinition(event.type);
  if (!definition) throw new Error(`Unknown manager event: ${event.type}`);
  const envelope = parsePublicEventEnvelope(
    {
      id: `evt_${randomUUID()}`,
      seq,
      type: event.type,
      ts,
      durability: event.durability ?? definition.durability,
      data: redactManagerEvent({
        ...(isObject(event.payload) ? event.payload : { value: event.payload }),
        sandboxId: event.sandboxId,
      }),
    },
    "sandbox_manager",
  );
  const stored = {
    sandboxId: storeId,
    id: envelope.id,
    seq: envelope.seq,
    type: envelope.type,
    ts: envelope.ts,
    durability: envelope.durability,
    payload: envelope.data,
  };
  if (await state.events.append(stored)) {
    state.eventBus.publish({
      type: stored.type,
      stream,
      sandboxId: event.sandboxId,
      seq: stored.seq,
      id: stored.id,
      durability: stored.durability,
      payload: stored.payload,
      ts: stored.ts,
    });
  }
}

function nextSeq(events: Array<{ seq?: number }>): number {
  return Math.max(0, ...events.map((event) => event.seq ?? 0)) + 1;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
