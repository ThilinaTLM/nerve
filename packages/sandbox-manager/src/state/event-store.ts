import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { PostgresPool } from "../db/postgres.js";
import { dbTables } from "../db/tables.js";
import { atomicWriteFile, isNotFound } from "./atomic-write.js";

/** One complete sequenced event stored in a dense sandbox or manager stream. */
export type StoredSandboxEvent = {
  sandboxId: string;
  seq: number;
  id: string;
  type: string;
  ts: string;
  payload: unknown;
};

type StoredEventRow = {
  sandbox_id: string | null;
  event_id: string | null;
  seq: string | number | null;
  type: string | null;
  ts: Date | string | null;
  payload: unknown;
};

export type SandboxEventStreamState = {
  latestSeq: number;
  earliestAvailableSeq: number;
};

export type EventRange = SandboxEventStreamState & {
  events: StoredSandboxEvent[];
};

export type SandboxEpochResetResult = SandboxEventStreamState & {
  reset: boolean;
  previousLatestSeq: number;
};

export interface SandboxEventStore {
  append(event: StoredSandboxEvent): Promise<boolean>;
  appendBatch(events: readonly StoredSandboxEvent[]): Promise<void>;
  findConflicts(
    sandboxId: string,
    candidates: readonly Pick<StoredSandboxEvent, "id" | "seq">[],
  ): Promise<StoredSandboxEvent[]>;
  readRange(
    sandboxId: string,
    fromSeq: number,
    limit: number,
  ): Promise<EventRange>;
  list(sandboxId: string): Promise<StoredSandboxEvent[]>;
  /** Aggregate dense stream bounds without materializing event history. */
  streamState(sandboxId: string): Promise<SandboxEventStreamState>;
  /** Archive and clear a stale manager epoch when the agent high-water regresses. */
  archiveEpochIfAhead(
    sandboxId: string,
    agentLatestSeq: number,
  ): Promise<SandboxEpochResetResult>;
  /** Remove all journal rows owned by a deleted sandbox. */
  deleteAll(sandboxId: string): Promise<void>;
}

export class PostgresEventStore implements SandboxEventStore {
  constructor(private readonly pool: PostgresPool) {}

  async append(event: StoredSandboxEvent): Promise<boolean> {
    const result = await this.pool.query(
      `insert into ${dbTables.sandboxEvents}
        (sandbox_id, event_id, seq, type, ts, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict do nothing`,
      [
        event.sandboxId,
        event.id,
        event.seq,
        event.type,
        event.ts,
        JSON.stringify(event.payload),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async appendBatch(events: readonly StoredSandboxEvent[]): Promise<void> {
    if (events.length === 0) return;
    const sandboxId = events[0]?.sandboxId;
    if (!sandboxId || events.some((event) => event.sandboxId !== sandboxId))
      throw new Error("Event batch must target one stream");
    await this.pool.query(
      `insert into ${dbTables.sandboxEvents}
        (sandbox_id, event_id, seq, type, ts, payload)
       select sandbox_id, event_id, seq, type, ts, payload
       from jsonb_to_recordset($1::jsonb) as record(
         sandbox_id text,
         event_id text,
         seq bigint,
         type text,
         ts timestamptz,
         payload jsonb
       )`,
      [
        JSON.stringify(
          events.map((event) => ({
            sandbox_id: event.sandboxId,
            event_id: event.id,
            seq: event.seq,
            type: event.type,
            ts: event.ts,
            payload: event.payload,
          })),
        ),
      ],
    );
  }

  async findConflicts(
    sandboxId: string,
    candidates: readonly Pick<StoredSandboxEvent, "id" | "seq">[],
  ): Promise<StoredSandboxEvent[]> {
    if (candidates.length === 0) return [];
    const result = await this.pool.query<StoredEventRow>(
      `select sandbox_id, event_id, seq, type, ts, payload
       from ${dbTables.sandboxEvents}
       where sandbox_id = $1
         and (event_id = any($2::text[]) or seq = any($3::bigint[]))
       order by seq`,
      [
        sandboxId,
        candidates.map((candidate) => candidate.id),
        candidates.map((candidate) => candidate.seq),
      ],
    );
    return result.rows.map(storedEventFromRow);
  }

  async readRange(
    sandboxId: string,
    fromSeq: number,
    limit: number,
  ): Promise<EventRange> {
    const [state, result] = await Promise.all([
      this.streamState(sandboxId),
      this.pool.query<StoredEventRow>(
        `select sandbox_id, event_id, seq, type, ts, payload
         from ${dbTables.sandboxEvents}
         where sandbox_id = $1 and seq >= $2
         order by seq
         limit $3`,
        [sandboxId, fromSeq, limit],
      ),
    ]);
    return { ...state, events: result.rows.map(storedEventFromRow) };
  }

  async streamState(sandboxId: string): Promise<SandboxEventStreamState> {
    const result = await this.pool.query<{
      latest_seq: string | number | null;
      earliest_seq: string | number | null;
    }>(
      `select max(seq) as latest_seq, min(seq) as earliest_seq
       from ${dbTables.sandboxEvents}
       where sandbox_id = $1`,
      [sandboxId],
    );
    const latestSeq = Number(result.rows[0]?.latest_seq ?? 0);
    return {
      latestSeq,
      earliestAvailableSeq: Number(result.rows[0]?.earliest_seq ?? 1),
    };
  }

  async list(sandboxId: string): Promise<StoredSandboxEvent[]> {
    const result = await this.pool.query<StoredEventRow>(
      `select sandbox_id, event_id, seq, type, ts, payload
       from ${dbTables.sandboxEvents}
       where sandbox_id = $1
       order by seq`,
      [sandboxId],
    );
    return result.rows.map(storedEventFromRow);
  }

  async archiveEpochIfAhead(
    sandboxId: string,
    agentLatestSeq: number,
  ): Promise<SandboxEpochResetResult> {
    const result = await this.pool.query<{ seq: string | number }>(
      `with stream as (
         select max(seq) as latest_seq
         from ${dbTables.sandboxEvents}
         where sandbox_id = $1
       ), removed as (
         delete from ${dbTables.sandboxEvents}
         where sandbox_id = $1
           and (select coalesce(latest_seq, 0) from stream) > $2
         returning id, sandbox_id, event_id, seq, type, ts, payload, received_at
       )
       insert into ${dbTables.sandboxEventsArchive}
         (source_id, sandbox_id, event_id, seq, type, ts, payload,
          received_at, archived_at, archive_reason, agent_head_seq)
       select id, sandbox_id, event_id, seq, type, ts, payload,
              received_at, now(), 'agent_epoch_reset', $2
       from removed
       returning seq`,
      [sandboxId, agentLatestSeq],
    );
    if (result.rows.length > 0) {
      return {
        reset: true,
        previousLatestSeq: Math.max(
          ...result.rows.map((row) => Number(row.seq)),
        ),
        latestSeq: 0,
        earliestAvailableSeq: 1,
      };
    }
    const state = await this.streamState(sandboxId);
    return { reset: false, previousLatestSeq: state.latestSeq, ...state };
  }

  async deleteAll(sandboxId: string): Promise<void> {
    await this.pool.query(
      `delete from ${dbTables.sandboxEvents} where sandbox_id = $1`,
      [sandboxId],
    );
  }
}

/** File-backed implementation used by focused tests and local fixtures. */
export class EventStore implements SandboxEventStore {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDir: string) {}

  async append(event: StoredSandboxEvent): Promise<boolean> {
    await mkdir(this.rootDir, { recursive: true });
    return this.withSandboxQueue(event.sandboxId, async () => {
      const existing = await this.list(event.sandboxId);
      if (
        existing.some((item) => item.id === event.id || item.seq === event.seq)
      )
        return false;
      assertAppendContinuity(existing, [event]);
      existing.push(event);
      await writeJson(
        path.join(this.rootDir, `${event.sandboxId}.json`),
        existing,
      );
      return true;
    });
  }

  async appendBatch(events: readonly StoredSandboxEvent[]): Promise<void> {
    if (events.length === 0) return;
    const sandboxId = events[0]?.sandboxId;
    if (!sandboxId || events.some((event) => event.sandboxId !== sandboxId))
      throw new Error("Event batch must target one stream");
    await mkdir(this.rootDir, { recursive: true });
    await this.withSandboxQueue(sandboxId, async () => {
      const existing = await this.list(sandboxId);
      const ids = new Set(existing.map((event) => event.id));
      const sequences = new Set(existing.map((event) => event.seq));
      if (events.some((event) => ids.has(event.id) || sequences.has(event.seq)))
        throw new Error("Sandbox event conflict");
      assertAppendContinuity(existing, events);
      await writeJson(path.join(this.rootDir, `${sandboxId}.json`), [
        ...existing,
        ...events,
      ]);
    });
  }

  async findConflicts(
    sandboxId: string,
    candidates: readonly Pick<StoredSandboxEvent, "id" | "seq">[],
  ): Promise<StoredSandboxEvent[]> {
    const ids = new Set(candidates.map((candidate) => candidate.id));
    const sequences = new Set(candidates.map((candidate) => candidate.seq));
    return (await this.list(sandboxId)).filter(
      (event) => ids.has(event.id) || sequences.has(event.seq),
    );
  }

  async readRange(
    sandboxId: string,
    fromSeq: number,
    limit: number,
  ): Promise<EventRange> {
    const events = await this.list(sandboxId);
    return {
      ...eventStreamState(events),
      events: events.filter((event) => event.seq >= fromSeq).slice(0, limit),
    };
  }

  async list(sandboxId: string): Promise<StoredSandboxEvent[]> {
    try {
      const file = path.join(this.rootDir, `${sandboxId}.json`);
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed))
        throw new Error("Event store must be an array");
      if (parsed.some(isLegacyEvent)) {
        const archiveDir = path.join(
          this.rootDir,
          "archive",
          `pre-dense-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
        );
        await mkdir(archiveDir, { recursive: true });
        await rename(file, path.join(archiveDir, path.basename(file)));
        return [];
      }
      return parsed as StoredSandboxEvent[];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async streamState(sandboxId: string): Promise<SandboxEventStreamState> {
    return eventStreamState(await this.list(sandboxId));
  }

  async archiveEpochIfAhead(
    sandboxId: string,
    agentLatestSeq: number,
  ): Promise<SandboxEpochResetResult> {
    return this.withSandboxQueue(sandboxId, async () => {
      const events = await this.list(sandboxId);
      const previous = eventStreamState(events);
      if (previous.latestSeq <= agentLatestSeq) {
        return {
          reset: false,
          previousLatestSeq: previous.latestSeq,
          ...previous,
        };
      }
      const file = path.join(this.rootDir, `${sandboxId}.json`);
      const archiveDir = path.join(this.rootDir, "archive", "epochs");
      await mkdir(archiveDir, { recursive: true });
      await rename(
        file,
        path.join(
          archiveDir,
          `${sandboxId}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-head-${agentLatestSeq}.json`,
        ),
      );
      return {
        reset: true,
        previousLatestSeq: previous.latestSeq,
        latestSeq: 0,
        earliestAvailableSeq: 1,
      };
    });
  }

  async deleteAll(sandboxId: string): Promise<void> {
    await this.withSandboxQueue(sandboxId, () =>
      rm(path.join(this.rootDir, `${sandboxId}.json`), { force: true }),
    );
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

function storedEventFromRow(row: StoredEventRow): StoredSandboxEvent {
  if (
    !row.sandbox_id ||
    !row.event_id ||
    row.seq === null ||
    !row.type ||
    row.ts === null
  )
    throw new Error("Event store returned an incomplete sequenced event");
  return {
    sandboxId: row.sandbox_id,
    id: row.event_id,
    seq: Number(row.seq),
    type: row.type,
    ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
    payload: row.payload,
  };
}

function assertAppendContinuity(
  existing: readonly StoredSandboxEvent[],
  events: readonly StoredSandboxEvent[],
): void {
  let expected = (existing.at(-1)?.seq ?? 0) + 1;
  for (const event of events) {
    if (event.seq !== expected)
      throw new Error(
        `Dense event sequence expected ${expected}, received ${event.seq}`,
      );
    expected += 1;
  }
}

function isLegacyEvent(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const event = value as Record<string, unknown>;
  return (
    "durability" in event ||
    typeof event.id !== "string" ||
    typeof event.seq !== "number" ||
    typeof event.ts !== "string"
  );
}

/** Derive dense stream bounds from an in-memory event list. */
export function eventStreamState(
  events: readonly StoredSandboxEvent[],
): SandboxEventStreamState {
  const sequences = events.map((event) => event.seq);
  return {
    latestSeq: Math.max(0, ...sequences),
    earliestAvailableSeq: sequences.length ? Math.min(...sequences) : 1,
  };
}
