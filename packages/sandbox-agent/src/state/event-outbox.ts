import {
  type SandboxAckState,
  type SandboxOutboxRecord,
  publicEventDefinition,
  sandboxAckStateSchema,
  sandboxOutboxRecordSchema,
  validatePublicEvent,
} from "@nervekit/contracts";
import { JsonStore } from "./json-store.js";
import { JsonlStore } from "./jsonl-store.js";

export class EventOutbox {
  private readonly outbox: JsonlStore<SandboxOutboxRecord>;
  private readonly ackStore: JsonStore<SandboxAckState>;
  private records: SandboxOutboxRecord[] = [];
  private transientRecords: SandboxOutboxRecord[] = [];
  private nextSeq = 1;
  private listeners = new Set<(record: SandboxOutboxRecord) => void>();
  private appendTail: Promise<unknown> = Promise.resolve();
  constructor(outboxPath: string, ackPath: string) {
    this.outbox = new JsonlStore(outboxPath, sandboxOutboxRecordSchema);
    this.ackStore = new JsonStore(ackPath, sandboxAckStateSchema);
  }
  async load(): Promise<void> {
    this.records = await this.outbox.readAll();
    this.transientRecords = [];
    this.nextSeq = Math.max(0, ...this.records.map((record) => record.seq)) + 1;
  }
  append(
    input: Omit<SandboxOutboxRecord, "seq" | "id" | "ts"> & {
      id?: string;
      ts?: string;
    },
  ): Promise<SandboxOutboxRecord> {
    const next = this.appendTail
      .catch(() => undefined)
      .then(() => this.appendSerialized(input));
    this.appendTail = next.catch(() => undefined);
    return next;
  }

  private async appendSerialized(
    input: Omit<SandboxOutboxRecord, "seq" | "id" | "ts"> & {
      id?: string;
      ts?: string;
    },
  ): Promise<SandboxOutboxRecord> {
    const definition = publicEventDefinition(input.type);
    if (!definition) throw new Error(`Unknown public event: ${input.type}`);
    if (input.durability !== definition.durability) {
      throw new Error(`Event ${input.type} must use ${definition.durability}`);
    }
    const data = validatePublicEvent(input.type, input.data, "sandbox_agent");
    if (input.id) {
      const existing = [...this.records, ...this.transientRecords].find(
        (record) => record.id === input.id,
      );
      if (existing) {
        if (
          existing.type !== input.type ||
          existing.durability !== input.durability ||
          JSON.stringify(existing.data) !== JSON.stringify(data)
        ) {
          throw new Error(`Conflicting event intent id: ${input.id}`);
        }
        return existing;
      }
    }
    const record: SandboxOutboxRecord = {
      ...input,
      data,
      seq: this.nextSeq++,
      id: input.id ?? `evt_${Date.now()}_${this.nextSeq}`,
      ts: input.ts ?? new Date().toISOString(),
    };
    if (record.durability === "durable") {
      await this.outbox.append(record);
      this.records.push(record);
    } else {
      if (this.transientRecords.length >= 256) this.transientRecords.shift();
      this.transientRecords.push(record);
    }
    for (const listener of this.listeners) listener(record);
    return record;
  }
  subscribe(listener: (record: SandboxOutboxRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async ack(stream: string, processedSeq: number): Promise<SandboxAckState> {
    const current = await this.ackStore.read({
      streams: [],
      updatedAt: new Date().toISOString(),
    });
    const previous = current.streams.find((entry) => entry.stream === stream);
    const nextProcessedSeq = Math.max(
      previous?.processedSeq ?? 0,
      processedSeq,
    );
    const streams = current.streams.filter((entry) => entry.stream !== stream);
    streams.push({ stream, processedSeq: nextProcessedSeq });
    streams.sort((left, right) => left.stream.localeCompare(right.stream));
    const next = { streams, updatedAt: new Date().toISOString() };
    await this.ackStore.write(next);
    return next;
  }
  async ackState(): Promise<SandboxAckState> {
    return this.ackStore.read({
      streams: [],
      updatedAt: new Date().toISOString(),
    });
  }
  unacked(processedSeq = 0): SandboxOutboxRecord[] {
    return this.records.filter(
      (record) => record.durability === "durable" && record.seq > processedSeq,
    );
  }
  all(): SandboxOutboxRecord[] {
    return [...this.records, ...this.transientRecords].sort(
      (left, right) => left.seq - right.seq,
    );
  }
}
