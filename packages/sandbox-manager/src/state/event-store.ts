import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";
import { atomicWriteFile, isNotFound } from "./atomic-write.js";

export type StoredSandboxEvent = {
  sandboxId: string;
  seq?: number;
  id?: string;
  type: string;
  ts?: string;
  durability?: "durable" | "transient";
  payload: unknown;
};
export type SandboxEventStreamState = {
  latestSeq: number;
  durableSeq: number;
  /** Lowest durable seq still stored, when any durable events exist. */
  firstDurableSeq?: number;
};

export interface SandboxEventStore {
  append(event: StoredSandboxEvent): Promise<boolean>;
  list(sandboxId: string): Promise<StoredSandboxEvent[]>;
  /**
   * Aggregate stream cursors without materializing the event history. Used on
   * every UI protocol connect, so it must stay O(1) relative to history size.
   */
  streamState(sandboxId: string): Promise<SandboxEventStreamState>;
}

export class PostgresEventStore implements SandboxEventStore {
  constructor(private readonly pool: PostgresPool) {}

  async append(event: StoredSandboxEvent): Promise<boolean> {
    const result = await this.pool.query(
      `insert into ${dbTables.sandboxEvents}
        (sandbox_id, event_id, seq, type, ts, durability, payload)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       on conflict do nothing`,
      [
        event.sandboxId,
        event.id ?? null,
        event.seq ?? null,
        event.type,
        event.ts ?? null,
        event.durability ?? "durable",
        JSON.stringify(event.payload),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async streamState(sandboxId: string): Promise<SandboxEventStreamState> {
    const result = await this.pool.query<{
      latest_seq: string | number | null;
      durable_seq: string | number | null;
      first_durable_seq: string | number | null;
    }>(
      `select
         max(seq) as latest_seq,
         max(seq) filter (where durability <> 'transient') as durable_seq,
         min(seq) filter (where durability <> 'transient') as first_durable_seq
       from ${dbTables.sandboxEvents}
       where sandbox_id = $1`,
      [sandboxId],
    );
    const row = result.rows[0];
    return {
      latestSeq: row?.latest_seq === null ? 0 : Number(row?.latest_seq ?? 0),
      durableSeq: row?.durable_seq === null ? 0 : Number(row?.durable_seq ?? 0),
      firstDurableSeq:
        row?.first_durable_seq === null || row?.first_durable_seq === undefined
          ? undefined
          : Number(row.first_durable_seq),
    };
  }

  async list(sandboxId: string): Promise<StoredSandboxEvent[]> {
    const result = await this.pool.query<{
      sandbox_id: string;
      event_id: string | null;
      seq: string | number | null;
      type: string;
      ts: Date | string | null;
      durability: "durable" | "transient";
      payload: unknown;
    }>(
      `select sandbox_id, event_id, seq, type, ts, durability, payload
       from ${dbTables.sandboxEvents}
       where sandbox_id = $1
       order by coalesce(seq, 0), id`,
      [sandboxId],
    );
    return result.rows.map((row) => ({
      sandboxId: row.sandbox_id,
      id: row.event_id ?? undefined,
      seq: row.seq === null ? undefined : Number(row.seq),
      type: row.type,
      ts:
        row.ts instanceof Date
          ? row.ts.toISOString()
          : row.ts === null
            ? undefined
            : row.ts,
      durability: row.durability,
      payload: row.payload,
    }));
  }
}

export class EventStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDir: string) {}
  async append(event: StoredSandboxEvent): Promise<boolean> {
    await mkdir(this.rootDir, { recursive: true });
    return this.withSandboxQueue(event.sandboxId, async () => {
      const existing = await this.list(event.sandboxId);
      if (
        existing.some(
          (item) =>
            (event.id && item.id === event.id) ||
            (event.seq !== undefined && item.seq === event.seq),
        )
      )
        return false;
      existing.push(event);
      await writeJson(
        path.join(this.rootDir, `${event.sandboxId}.json`),
        existing,
      );
      return true;
    });
  }
  async list(sandboxId: string): Promise<StoredSandboxEvent[]> {
    try {
      const raw = await readFile(
        path.join(this.rootDir, `${sandboxId}.json`),
        "utf8",
      );
      return JSON.parse(raw) as StoredSandboxEvent[];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async streamState(sandboxId: string): Promise<SandboxEventStreamState> {
    return eventStreamState(await this.list(sandboxId));
  }

  private async withSandboxQueue<T>(
    sandboxId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(sandboxId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    const queued = next
      .catch(() => undefined)
      .finally(() => {
        if (this.queues.get(sandboxId) === queued)
          this.queues.delete(sandboxId);
      });
    this.queues.set(sandboxId, queued);
    return next;
  }
}
async function writeJson(file: string, value: unknown): Promise<void> {
  await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

/** Derive stream cursors from an in-memory event list (file-backed stores). */
export function eventStreamState(
  events: readonly StoredSandboxEvent[],
): SandboxEventStreamState {
  const durable = events.filter((event) => event.durability !== "transient");
  const durableSeqs = durable
    .map((event) => event.seq)
    .filter((seq): seq is number => seq !== undefined);
  return {
    latestSeq: Math.max(
      0,
      ...events
        .map((event) => event.seq)
        .filter((seq): seq is number => seq !== undefined),
    ),
    durableSeq: Math.max(0, ...durableSeqs),
    firstDurableSeq: durableSeqs.length ? Math.min(...durableSeqs) : undefined,
  };
}
