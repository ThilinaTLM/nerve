import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  eventEnvelopeSchema,
  type EventEnvelope,
  type StreamState,
} from "@nervekit/contracts";
import {
  atomicWriteFile,
  pathExists,
  readJsonLines,
  type RenameDependencies,
} from "../storage/index.js";

export interface StreamLogOptions {
  readonly stream: string;
  readonly logPath: string;
  readonly metaPath: string;
  readonly retentionEvents?: number;
  readonly retentionBytes?: number;
  readonly flushDelayMs?: number;
  readonly flushEventThreshold?: number;
  readonly onFsync?: () => void;
  readonly renameDependencies?: RenameDependencies;
}

export class StreamLog {
  readonly stream: string;
  readonly logPath: string;
  readonly metaPath: string;

  readonly #retentionEvents: number;
  readonly #retentionBytes: number;
  readonly #flushDelayMs: number;
  readonly #flushEventThreshold: number;
  readonly #onFsync?: () => void;
  readonly #renameDependencies?: RenameDependencies;
  readonly #events: EventEnvelope[] = [];
  readonly #pending: EventEnvelope[] = [];

  #lastSeq = 0;
  #flushTimer?: ReturnType<typeof setTimeout>;
  #flushTail: Promise<void> = Promise.resolve();
  #closed = false;

  private constructor(options: StreamLogOptions) {
    this.stream = options.stream;
    this.logPath = options.logPath;
    this.metaPath = options.metaPath;
    this.#retentionEvents = options.retentionEvents ?? 5_000;
    this.#retentionBytes = options.retentionBytes ?? 8 * 1_024 * 1_024;
    this.#flushDelayMs = options.flushDelayMs ?? 25;
    this.#flushEventThreshold = options.flushEventThreshold ?? 64;
    this.#onFsync = options.onFsync;
    this.#renameDependencies = options.renameDependencies;
  }

  static async open(options: StreamLogOptions): Promise<StreamLog> {
    const log = new StreamLog(options);
    await log.#hydrate();
    return log;
  }

  async append(
    intentId: string,
    type: string,
    data: unknown,
    supersedable: boolean,
    occurredAt = new Date().toISOString(),
  ): Promise<EventEnvelope> {
    const existing = this.#events.find((event) => event.id === intentId);
    if (existing) {
      if (
        existing.type !== type ||
        JSON.stringify(existing.data) !== JSON.stringify(data)
      )
        throw new Error(`Conflicting event intent id: ${intentId}`);
      return existing;
    }
    if (this.#closed) throw new Error(`Stream log ${this.stream} is closed`);
    const event = eventEnvelopeSchema.parse({
      seq: this.#lastSeq + 1,
      id: intentId,
      ts: occurredAt,
      type,
      data,
    }) as EventEnvelope;
    this.#lastSeq = event.seq;
    this.#events.push(event);
    this.#pending.push(event);

    if (!supersedable) {
      await this.flush();
    } else if (this.#pending.length >= this.#flushEventThreshold) {
      this.#flushInBackground();
    } else {
      this.#scheduleFlush();
    }
    return event;
  }

  eventForIntent(intentId: string): EventEnvelope | undefined {
    return this.#events.find((event) => event.id === intentId);
  }

  read(fromSeq: number, limit: number): EventEnvelope[] {
    if (limit <= 0) return [];
    return this.#events.filter((event) => event.seq >= fromSeq).slice(0, limit);
  }

  bounds(): StreamState {
    return {
      stream: this.stream,
      latestSeq: this.#lastSeq,
      earliestAvailableSeq:
        this.#events[0]?.seq ?? (this.#lastSeq === 0 ? 1 : this.#lastSeq + 1),
    };
  }

  async flush(): Promise<void> {
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    const pending = this.#pending.splice(0);
    if (pending.length === 0) {
      await this.#flushTail;
      return;
    }
    const durableThroughSeq = pending.at(-1)?.seq;
    if (durableThroughSeq === undefined) return;
    const flush = this.#flushTail.then(async () => {
      await mkdir(dirname(this.logPath), { recursive: true });
      const handle = await open(this.logPath, "a", 0o600);
      try {
        await handle.write(
          pending.map((event) => `${JSON.stringify(event)}\n`).join(""),
          undefined,
          "utf8",
        );
        await handle.sync();
        this.#onFsync?.();
      } finally {
        await handle.close();
      }
      await writeMeta(
        this.metaPath,
        durableThroughSeq,
        this.#onFsync,
        this.#renameDependencies,
      );
      await this.#applyRetention(durableThroughSeq);
    });
    this.#flushTail = flush;
    await flush;
  }

  async truncateBelow(seq: number): Promise<void> {
    await this.flush();
    const retained = this.#events.filter((event) => event.seq >= seq);
    this.#events.splice(0, this.#events.length, ...retained);
    await rewriteLog(
      this.logPath,
      retained,
      this.#onFsync,
      this.#renameDependencies,
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    await this.flush();
  }

  async remove(): Promise<void> {
    await this.close();
    await Promise.all([
      rm(this.logPath, { force: true }),
      rm(this.metaPath, { force: true }),
    ]);
  }

  async #hydrate(): Promise<void> {
    const parsed = (await readJsonLines<unknown>(this.logPath).catch(() => []))
      .map((value) => eventEnvelopeSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data as EventEnvelope)
      .sort((left, right) => left.seq - right.seq);
    this.#events.push(...parsed);
    const meta = await readMeta(this.metaPath);
    this.#lastSeq = Math.max(meta, parsed.at(-1)?.seq ?? 0);
    if (!(await pathExists(this.metaPath))) {
      await writeMeta(
        this.metaPath,
        this.#lastSeq,
        this.#onFsync,
        this.#renameDependencies,
      );
    }
    await this.#applyRetention(this.#lastSeq);
  }

  #scheduleFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      this.#flushInBackground();
    }, this.#flushDelayMs);
    this.#flushTimer.unref?.();
  }

  #flushInBackground(): void {
    void this.flush().catch((error: unknown) => {
      process.emitWarning(
        `Failed to flush stream ${this.stream}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async #applyRetention(durableThroughSeq: number): Promise<void> {
    const durableEvents = this.#events.filter(
      (event) => event.seq <= durableThroughSeq,
    );
    let bytes = durableEvents.reduce(
      (total, event) => total + Buffer.byteLength(`${JSON.stringify(event)}\n`),
      0,
    );
    let removeCount = 0;
    while (
      durableEvents.length - removeCount > 1 &&
      (durableEvents.length - removeCount > this.#retentionEvents ||
        bytes > this.#retentionBytes)
    ) {
      const event = durableEvents[removeCount] as EventEnvelope;
      bytes -= Buffer.byteLength(`${JSON.stringify(event)}\n`);
      removeCount += 1;
    }
    if (removeCount === 0) return;

    const retainedDurableEvents = durableEvents.slice(removeCount);
    const firstRetainedSeq = retainedDurableEvents[0]?.seq;
    if (firstRetainedSeq === undefined) return;
    const retainedEvents = this.#events.filter(
      (event) => event.seq >= firstRetainedSeq,
    );
    this.#events.splice(0, this.#events.length, ...retainedEvents);
    await rewriteLog(
      this.logPath,
      retainedDurableEvents,
      this.#onFsync,
      this.#renameDependencies,
    );
  }
}

async function readMeta(path: string): Promise<number> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      lastSeq?: unknown;
    };
    return typeof value.lastSeq === "number" &&
      Number.isSafeInteger(value.lastSeq)
      ? Math.max(0, value.lastSeq)
      : 0;
  } catch {
    return 0;
  }
}

async function writeMeta(
  path: string,
  lastSeq: number,
  onFsync?: () => void,
  renameDependencies?: RenameDependencies,
): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify({ lastSeq })}\n`, {
    mode: 0o600,
    onFsync,
    ...renameDependencies,
  });
}

async function rewriteLog(
  path: string,
  events: readonly EventEnvelope[],
  onFsync?: () => void,
  renameDependencies?: RenameDependencies,
): Promise<void> {
  const contents = events.map((event) => JSON.stringify(event)).join("\n");
  await atomicWriteFile(path, contents ? `${contents}\n` : "", {
    mode: 0o600,
    onFsync,
    ...renameDependencies,
  });
}
