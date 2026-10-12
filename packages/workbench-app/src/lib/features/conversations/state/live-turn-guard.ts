/** Prevent delayed ephemeral updates from reopening a superseded live turn. */
export class LiveTurnGuard {
  private readonly finalized = new Set<string>();
  private readonly active = new Set<string>();

  accept(turnId: string): boolean {
    if (this.finalized.has(turnId)) return false;
    this.active.add(turnId);
    return true;
  }

  finalize(turnId: string): void {
    this.active.delete(turnId);
    this.finalized.add(turnId);
  }

  finalizeActive(): void {
    for (const turnId of this.active) this.finalized.add(turnId);
    this.active.clear();
  }

  /** Recovery establishes the selected durable history afresh. */
  recover(finalizedTurns: Iterable<string>): void {
    this.active.clear();
    this.finalized.clear();
    for (const turnId of finalizedTurns) this.finalized.add(turnId);
  }
}
