import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createId, type EventEnvelope } from "@nerve/shared";

export class EventBus {
  #seq = 0;
  #events: EventEnvelope[] = [];
  #listeners = new Set<(event: EventEnvelope) => void>();

  constructor(
    private readonly dataDir: string,
    private readonly maxBufferedEvents = 1000,
  ) {}

  async publish<T>(type: string, data: T): Promise<EventEnvelope<T>> {
    this.#seq += 1;
    const event: EventEnvelope<T> = {
      seq: this.#seq,
      id: createId("evt"),
      ts: new Date().toISOString(),
      type,
      data,
    };
    this.#events.push(event as EventEnvelope);
    if (this.#events.length > this.maxBufferedEvents) this.#events.shift();
    await this.persist(event);
    for (const listener of this.#listeners) listener(event as EventEnvelope);
    return event;
  }

  replaySince(seq = 0): EventEnvelope[] {
    return this.#events.filter((event) => event.seq > seq);
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private async persist(event: EventEnvelope): Promise<void> {
    const dir = join(this.dataDir, "logs");
    await mkdir(dir, { recursive: true });
    await appendFile(
      join(dir, "events.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }
}
