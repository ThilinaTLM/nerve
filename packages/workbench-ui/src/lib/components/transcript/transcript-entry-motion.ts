export type TranscriptEntranceCandidate = {
  key: string;
  eligible: boolean;
};

/**
 * Per-conversation one-shot entrance ledger. Initial history is seeded without
 * motion; later eligible live keys receive tokens that can be claimed once.
 * Seen keys are intentionally never removed during a scope, so replay gaps and
 * virtual-row remounts cannot make an old row look new.
 */
export class TranscriptEntryMotionLedger {
  private scope: string | undefined;
  private seeded = false;
  private sequence = 0;
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, string>();

  project(
    scope: string,
    candidates: readonly TranscriptEntranceCandidate[],
  ): Map<string, string> {
    if (scope !== this.scope) this.reset(scope);

    if (!this.seeded) {
      for (const candidate of candidates) this.seen.add(candidate.key);
      this.seeded = true;
      return new Map();
    }

    for (const candidate of candidates) {
      if (this.seen.has(candidate.key)) continue;
      this.seen.add(candidate.key);
      if (!candidate.eligible) continue;
      this.sequence += 1;
      this.pending.set(candidate.key, `${this.sequence}`);
    }

    const projectedKeys = new Set(candidates.map((candidate) => candidate.key));
    for (const key of this.pending.keys()) {
      if (!projectedKeys.has(key)) this.pending.delete(key);
    }

    return new Map(
      candidates.flatMap((candidate) => {
        const token = this.pending.get(candidate.key);
        return token ? [[candidate.key, token] as const] : [];
      }),
    );
  }

  /** Atomically acknowledge an entrance before its DOM animation starts. */
  claim(key: string, token: string): boolean {
    if (this.pending.get(key) !== token) return false;
    this.pending.delete(key);
    return true;
  }

  private reset(scope: string): void {
    this.scope = scope;
    this.seeded = false;
    this.seen.clear();
    this.pending.clear();
  }
}
