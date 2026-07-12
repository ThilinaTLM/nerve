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
  private nextSeq = 1;
  private listeners = new Set<(record: SandboxOutboxRecord) => void>();
  constructor(outboxPath: string, ackPath: string) {
    this.outbox = new JsonlStore(outboxPath, sandboxOutboxRecordSchema);
    this.ackStore = new JsonStore(ackPath, sandboxAckStateSchema);
  }
  async load(): Promise<void> {
    this.records = await this.outbox.readAll();
    this.nextSeq = Math.max(0, ...this.records.map((record) => record.seq)) + 1;
  }
  async append(
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
    const record: SandboxOutboxRecord = {
      ...input,
      data: validatePublicEvent(input.type, input.data, "sandbox_agent"),
      seq: this.nextSeq++,
      id: input.id ?? `evt_${Date.now()}_${this.nextSeq}`,
      ts: input.ts ?? new Date().toISOString(),
    };
    if (record.durability === "durable") await this.outbox.append(record);
    this.records.push(record);
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
    return [...this.records];
  }
}
