import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  accessAuditEventSchema,
  type AccessAuditEvent,
} from "@nervekit/contracts/access";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Append-only JSONL trail of authentication events (`logs/access-audit.jsonl`).
 * Records identify devices and clients but never carry secrets. The file
 * rotates once to `.1` at 5 MiB. Failures to write never affect requests.
 */
export class AccessAuditLog {
  readonly #path: string;
  readonly #now: () => number;
  #writes: Promise<void> = Promise.resolve();

  constructor(path: string, options: { now?: () => number } = {}) {
    this.#path = path;
    this.#now = options.now ?? Date.now;
  }

  record(event: Omit<AccessAuditEvent, "at">): Promise<void> {
    const entry: AccessAuditEvent = {
      at: this.#now(),
      ...event,
      userAgent: event.userAgent?.slice(0, 200),
      detail: event.detail?.slice(0, 300),
    };
    this.#writes = this.#writes
      .catch(() => undefined)
      .then(() => this.#append(entry))
      .catch(() => undefined);
    return this.#writes;
  }

  async #append(entry: AccessAuditEvent): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const size = await stat(this.#path).then(
      (info) => info.size,
      () => 0,
    );
    if (size >= MAX_BYTES) await rename(this.#path, `${this.#path}.1`);
    await appendFile(this.#path, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  /** Newest first. */
  async recent(limit = 100): Promise<AccessAuditEvent[]> {
    await this.#writes.catch(() => undefined);
    const events: AccessAuditEvent[] = [];
    for (const path of [this.#path, `${this.#path}.1`]) {
      const text = await readFile(path, "utf8").catch(() => "");
      const lines = text.split("\n").filter(Boolean).reverse();
      for (const line of lines) {
        try {
          events.push(accessAuditEventSchema.parse(JSON.parse(line)));
        } catch {
          // Skip damaged lines.
        }
        if (events.length >= limit) return events;
      }
    }
    return events;
  }
}
