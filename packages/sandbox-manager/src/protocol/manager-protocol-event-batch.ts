import { createHash } from "node:crypto";
import type {
  EventBatchData,
  EventBatchReason,
  EventEnvelope,
} from "@nervekit/contracts";
import { eventBatchDataSchema } from "@nervekit/contracts";
import type { ManagerEvent } from "../events/manager-event-bus.js";
import type { StoredSandboxEvent } from "../state/event-store.js";

export function managerEventBatch(input: {
  stream: string;
  batchId: string;
  reason: EventBatchReason;
  events: Array<ManagerEvent | StoredSandboxEvent>;
  previousDurableSeq?: number | null;
  replay?: EventBatchData["replay"];
}): EventBatchData {
  const events = coalesceTransientEvents(
    input.events.map((event) => toEventEnvelope(input.stream, event)),
  ).sort((a, b) => a.seq - b.seq);
  const durable = events.filter((event) => event.durability === "durable");
  const data: EventBatchData = {
    stream: input.stream,
    batchId: input.batchId,
    reason: input.reason,
    events,
    range: events.length
      ? {
          firstSeq: events[0]?.seq ?? null,
          lastSeq: events.at(-1)?.seq ?? null,
          durableFirstSeq: durable[0]?.seq ?? null,
          durableLastSeq: durable.at(-1)?.seq ?? null,
          durableCount: durable.length,
          transientCount: events.length - durable.length,
          previousDurableSeq:
            durable.length > 0 ? (input.previousDurableSeq ?? 0) : undefined,
          durableCompleteThroughSeq: durable.at(-1)?.seq,
        }
      : {
          firstSeq: null,
          lastSeq: null,
          durableFirstSeq: null,
          durableLastSeq: null,
          durableCount: 0,
          transientCount: 0,
        },
  };
  if (input.replay) data.replay = input.replay;
  return eventBatchDataSchema.parse(data);
}

export function toEventEnvelope(
  stream: string,
  event: ManagerEvent | StoredSandboxEvent,
): EventEnvelope {
  const seq = Number(event.seq ?? 0);
  const ts = event.ts ?? new Date().toISOString();
  const type = event.type;
  return {
    id:
      event.id?.startsWith("evt_") === true
        ? event.id
        : syntheticEventId(stream, type, seq, ts),
    seq,
    ts,
    type,
    durability: event.durability ?? "durable",
    data: "payload" in event ? event.payload : undefined,
  };
}

function coalesceTransientEvents(events: EventEnvelope[]): EventEnvelope[] {
  const result: EventEnvelope[] = [];
  for (const event of events) {
    const previous = result.at(-1);
    if (previous && canCoalesce(previous, event)) {
      previous.data = coalescedData(previous.data, event.data);
      continue;
    }
    result.push({ ...event });
  }
  return result;
}

function canCoalesce(previous: EventEnvelope, next: EventEnvelope): boolean {
  if (previous.durability !== "transient" || next.durability !== "transient")
    return false;
  if (previous.type !== next.type) return false;
  if (
    ![
      "conversation.live.content.delta",
      "conversation.live.tool_draft.delta",
      "conversation.live.tool_output.delta",
    ].includes(previous.type)
  )
    return false;
  const previousData = previous.data;
  const nextData = next.data;
  if (!isRecord(previousData) || !isRecord(nextData)) return false;
  const delta =
    typeof previousData.delta === "string" ? previousData.delta : "";
  const previousOffset = Number(previousData.offset ?? 0);
  const nextOffset = Number(nextData.offset ?? -1);
  if (previousOffset + delta.length !== nextOffset) return false;
  for (const key of coalesceIdentityKeys(previous.type)) {
    if (previousData[key] !== nextData[key]) return false;
  }
  return true;
}

function coalescedData(previous: unknown, next: unknown): unknown {
  if (!isRecord(previous) || !isRecord(next)) return previous;
  return {
    ...previous,
    delta: `${String(previous.delta ?? "")}${String(next.delta ?? "")}`,
  };
}

function coalesceIdentityKeys(type: string): string[] {
  if (type === "conversation.live.tool_output.delta")
    return ["toolCallId", "stream"];
  return [
    "conversationId",
    "agentId",
    "runId",
    "turnId",
    "liveMessageId",
    "contentBlockId",
    "kind",
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function syntheticEventId(
  stream: string,
  type: string,
  seq: number,
  ts: string,
): string {
  return `evt_${createHash("sha256")
    .update(`${stream}:${type}:${seq}:${ts}`)
    .digest("hex")
    .slice(0, 24)}`;
}
