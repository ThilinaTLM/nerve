import type { EventEnvelope } from "$lib/api";
type AgentEvent = EventEnvelope<Record<string, unknown>>;

/** Preserve live updates that race an agent snapshot without replaying its rows. */
export class AgentEventBuffer {
  private lastSeq = -1;
  private pending: AgentEvent[] | undefined;

  begin(): void {
    this.pending = [];
  }
  accept(event: AgentEvent): boolean {
    if (this.pending) {
      this.pending.push(event);
      return false;
    }
    if (event.seq <= this.lastSeq) return false;
    this.lastSeq = event.seq;
    return true;
  }
  finish(snapshotSeq: number): AgentEvent[] {
    this.lastSeq = Math.max(this.lastSeq, snapshotSeq);
    const pending = this.pending ?? [];
    this.pending = undefined;
    return pending
      .sort((a, b) => a.seq - b.seq)
      .filter((event) => this.accept(event));
  }
}
