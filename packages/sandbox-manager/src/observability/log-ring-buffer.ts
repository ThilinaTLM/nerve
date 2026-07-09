import type {
  ManagerLogTailQuery,
  ManagerLogTailRecord,
  StructuredLogLevel,
  StructuredLogRecord,
} from "@nervekit/shared";

const LEVEL_ORDER: Record<StructuredLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Bounded in-memory ring buffer of the manager's own structured log records.
 * Fed via the shared logger's `onRecord` tap and read by the
 * `GET /api/manager/logs` tail endpoint. Each record gets a monotonic `seq` so
 * clients can poll with `sinceSeq`.
 */
export class LogRingBuffer {
  private readonly records: ManagerLogTailRecord[] = [];
  private seq = 0;
  private dropped = 0;

  constructor(private readonly capacity = 2000) {}

  push(record: StructuredLogRecord): void {
    this.seq += 1;
    this.records.push({ ...record, seq: this.seq });
    if (this.records.length > this.capacity) {
      this.records.shift();
      this.dropped += 1;
    }
  }

  query(query: ManagerLogTailQuery = {}): {
    logs: ManagerLogTailRecord[];
    nextCursor: number;
    dropped: number;
  } {
    const min = query.level ? LEVEL_ORDER[query.level] : 0;
    const needle = query.contains?.toLowerCase();
    const sinceSeq = query.sinceSeq ?? 0;
    const filtered = this.records.filter(
      (record) =>
        record.seq > sinceSeq &&
        LEVEL_ORDER[record.level] >= min &&
        (!needle || String(record.message).toLowerCase().includes(needle)),
    );
    const logs = filtered.slice(-(query.limit ?? 200));
    return {
      logs,
      nextCursor: logs.at(-1)?.seq ?? sinceSeq,
      dropped: this.dropped,
    };
  }
}
