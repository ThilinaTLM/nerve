import type { StreamCursor } from "@nervekit/contracts";

export class ProcessedAckTracker {
  readonly #processed = new Map<string, number>();
  readonly #received = new Map<string, number>();

  constructor(cursors: readonly StreamCursor[] = []) {
    for (const cursor of cursors)
      this.markProcessed(cursor.stream, cursor.processedSeq);
  }

  markReceived(stream: string, sequence: number): void {
    this.#received.set(
      stream,
      Math.max(this.#received.get(stream) ?? 0, sequence),
    );
  }

  markProcessed(stream: string, sequence: number): void {
    const received = this.#received.get(stream);
    if (received !== undefined && sequence > received) {
      throw new RangeError(
        "Cannot acknowledge an event sequence that was not received",
      );
    }
    this.#processed.set(
      stream,
      Math.max(this.#processed.get(stream) ?? 0, sequence),
    );
  }

  reset(cursors: readonly StreamCursor[]): void {
    this.#processed.clear();
    this.#received.clear();
    for (const cursor of cursors) {
      this.#received.set(cursor.stream, cursor.processedSeq);
      this.#processed.set(cursor.stream, cursor.processedSeq);
    }
  }

  processed(stream: string): number {
    return this.#processed.get(stream) ?? 0;
  }

  cursors(): StreamCursor[] {
    return [...this.#processed.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([stream, processedSeq]) => ({ stream, processedSeq }));
  }
}
