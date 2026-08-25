import type { EventEnvelope } from "@nervekit/contracts";

export class LiveEventBuffer {
  readonly #pending = new Map<string, EventEnvelope[]>();
  readonly #replay = new Map<string, EventEnvelope[]>();

  enqueue(stream: string, event: EventEnvelope, replaying: boolean): void {
    const queues = replaying ? this.#replay : this.#pending;
    const queue = queues.get(stream) ?? [];
    queue.push(event);
    queues.set(stream, queue);
  }

  all(): EventEnvelope[] {
    return [...this.#pending.values(), ...this.#replay.values()].flat();
  }

  takePending(): Map<string, EventEnvelope[]> {
    const pending = new Map(this.#pending);
    this.#pending.clear();
    return pending;
  }

  takeReplay(stream: string): EventEnvelope[] {
    const events = this.#replay.get(stream) ?? [];
    this.#replay.delete(stream);
    return events;
  }

  dropInactive(activeStreams: ReadonlySet<string>): void {
    for (const stream of this.#pending.keys()) {
      if (!activeStreams.has(stream)) this.#pending.delete(stream);
    }
    for (const stream of this.#replay.keys()) {
      if (!activeStreams.has(stream)) this.#replay.delete(stream);
    }
  }

  remove(stream: string): void {
    this.#pending.delete(stream);
    this.#replay.delete(stream);
  }

  clear(): void {
    this.#pending.clear();
    this.#replay.clear();
  }
}
