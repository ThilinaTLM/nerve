import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import {
  type NotifyEvent,
  type SandboxOutboxRecord,
  publicEventDefinition,
  sandboxOutboxRecordSchema,
  validatePublicEvent,
} from "@nervekit/contracts";
import { JsonStore } from "./json-store.js";
import { JsonlStore } from "./jsonl-store.js";

export interface OutboxEventInput {
  readonly type: string;
  readonly data: unknown;
  readonly id?: string;
  readonly ts?: string;
  readonly conversationId?: string;
  readonly agentId?: string;
  readonly runId?: string;
}

export type SandboxPublishedEvent = SandboxOutboxRecord | NotifyEvent;

export class EventOutbox {
  readonly #outbox: JsonlStore<SandboxOutboxRecord>;
  readonly #meta: JsonStore<{ lastSeq: number }>;
  readonly #records: SandboxOutboxRecord[] = [];
  readonly #notifyById = new Map<string, NotifyEvent>();
  readonly #listeners = new Set<(record: SandboxOutboxRecord) => void>();
  readonly #notifyListeners = new Set<(event: NotifyEvent) => void>();
  #nextSeq = 1;
  #appendTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly outboxPath: string,
    private readonly metaPath: string,
    private readonly legacyAckPath?: string,
  ) {
    this.#outbox = new JsonlStore(outboxPath, sandboxOutboxRecordSchema);
    this.#meta = new JsonStore(metaPath);
  }

  async load(): Promise<void> {
    await this.#archiveLegacyEpoch();
    this.#records.splice(
      0,
      this.#records.length,
      ...(await this.#outbox.readAll()),
    );
    const meta = await this.#meta.read({ lastSeq: 0 });
    const lastSeq = Math.max(meta.lastSeq, this.#records.at(-1)?.seq ?? 0);
    this.#nextSeq = lastSeq + 1;
    if (meta.lastSeq !== lastSeq) await this.#meta.write({ lastSeq });
  }

  append(input: OutboxEventInput): Promise<SandboxPublishedEvent> {
    const next = this.#appendTail
      .catch(() => undefined)
      .then(() => this.#appendSerialized(input));
    this.#appendTail = next.catch(() => undefined);
    return next;
  }

  subscribe(listener: (record: SandboxOutboxRecord) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeNotify(listener: (event: NotifyEvent) => void): () => void {
    this.#notifyListeners.add(listener);
    return () => this.#notifyListeners.delete(listener);
  }

  since(processedSeq = 0): SandboxOutboxRecord[] {
    return this.#records.filter((record) => record.seq > processedSeq);
  }

  all(): SandboxOutboxRecord[] {
    return [...this.#records];
  }

  async drain(): Promise<void> {
    await this.#appendTail;
  }

  latestSeq(): number {
    return this.#nextSeq - 1;
  }

  truncateThrough(processedSeq: number): Promise<void> {
    const next = this.#appendTail
      .catch(() => undefined)
      .then(async () => {
        const retained = this.#records.filter(
          (record) => record.seq > processedSeq,
        );
        if (retained.length === this.#records.length) return;
        await this.#outbox.replace(retained);
        this.#records.splice(0, this.#records.length, ...retained);
      });
    this.#appendTail = next.catch(() => undefined);
    return next;
  }

  async #appendSerialized(
    input: OutboxEventInput,
  ): Promise<SandboxPublishedEvent> {
    const definition = publicEventDefinition(input.type);
    if (!definition) throw new Error(`Unknown public event: ${input.type}`);
    const data = validatePublicEvent(input.type, input.data, "sandbox_agent");
    const id = input.id ?? `evt_${Date.now()}_${crypto.randomUUID()}`;
    const existing =
      this.#records.find((record) => record.id === id) ??
      this.#notifyById.get(id);
    if (existing) {
      if (
        existing.type !== input.type ||
        JSON.stringify(existing.data) !== JSON.stringify(data)
      ) {
        throw new Error(`Conflicting event intent id: ${id}`);
      }
      return existing;
    }

    const ts = input.ts ?? new Date().toISOString();
    if (definition.delivery === "ephemeral") {
      const event: NotifyEvent = { id, ts, type: input.type, data };
      this.#notifyById.set(id, event);
      if (this.#notifyById.size > 256) {
        const oldest = this.#notifyById.keys().next().value as
          | string
          | undefined;
        if (oldest) this.#notifyById.delete(oldest);
      }
      for (const listener of this.#notifyListeners) listener(event);
      return event;
    }

    const record = sandboxOutboxRecordSchema.parse({
      seq: this.#nextSeq,
      id,
      ts,
      type: input.type,
      delivery: "sequenced",
      data,
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
    });
    this.#nextSeq += 1;
    await this.#outbox.append(record);
    await this.#meta.write({ lastSeq: record.seq });
    this.#records.push(record);
    for (const listener of this.#listeners) listener(record);
    return record;
  }

  async #archiveLegacyEpoch(): Promise<void> {
    if (await exists(this.metaPath)) return;
    const hasOutbox = await exists(this.outboxPath);
    const hasLegacyAck = Boolean(
      this.legacyAckPath && (await exists(this.legacyAckPath)),
    );
    if (!hasOutbox && !hasLegacyAck) {
      await this.#meta.write({ lastSeq: 0 });
      return;
    }
    const archiveDir = path.join(
      path.dirname(this.outboxPath),
      "archive",
      `pre-dense-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
    );
    await mkdir(archiveDir, { recursive: true });
    if (hasOutbox) {
      await rename(
        this.outboxPath,
        path.join(archiveDir, path.basename(this.outboxPath)),
      );
    }
    if (this.legacyAckPath && hasLegacyAck) {
      await rename(
        this.legacyAckPath,
        path.join(archiveDir, path.basename(this.legacyAckPath)),
      );
    }
    await this.#meta.write({ lastSeq: 0 });
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
