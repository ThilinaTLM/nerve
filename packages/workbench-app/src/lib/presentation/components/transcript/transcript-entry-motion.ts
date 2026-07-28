import type {
  ConversationMotionAllocation,
  ConversationMotionProfile,
} from "./conversation-motion-budget";

export type TranscriptEntranceCandidate = {
  key: string;
  eligible: boolean;
};

export type TranscriptEntranceMotion = {
  token: string;
  profile: ConversationMotionProfile;
  delayMs: number;
};

type AllocateMotion = (count: number) => ConversationMotionAllocation;

function standardAllocation(count: number): ConversationMotionAllocation {
  return {
    profile: "standard",
    delaysMs: Array.from({ length: count }, () => 0),
  };
}

/**
 * Per-conversation one-shot entrance ledger. Initial history is seeded without
 * motion; later eligible live keys receive descriptors that can be claimed
 * once. Seen keys are intentionally never removed during a scope, so replay
 * gaps and virtual-row remounts cannot make an old row look new.
 */
export class TranscriptEntryMotionLedger {
  private scope: string | undefined;
  private seeded = false;
  private sequence = 0;
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, TranscriptEntranceMotion>();

  constructor(
    private readonly allocateMotion: AllocateMotion = standardAllocation,
  ) {}

  project(
    scope: string,
    candidates: readonly TranscriptEntranceCandidate[],
  ): Map<string, TranscriptEntranceMotion> {
    if (scope !== this.scope) this.reset(scope);

    if (!this.seeded) {
      for (const candidate of candidates) this.seen.add(candidate.key);
      this.seeded = true;
      return new Map();
    }

    const additions: Array<{ key: string; token: string }> = [];
    for (const candidate of candidates) {
      if (this.seen.has(candidate.key)) continue;
      this.seen.add(candidate.key);
      if (!candidate.eligible) continue;
      this.sequence += 1;
      additions.push({ key: candidate.key, token: `${this.sequence}` });
    }

    if (additions.length > 0) {
      const allocation = this.allocateMotion(additions.length);
      additions.forEach((addition, index) => {
        this.pending.set(addition.key, {
          token: addition.token,
          profile: allocation.profile,
          delayMs: allocation.delaysMs[index] ?? 0,
        });
      });
    }

    const projectedKeys = new Set(candidates.map((candidate) => candidate.key));
    for (const key of this.pending.keys()) {
      if (!projectedKeys.has(key)) this.pending.delete(key);
    }

    return new Map(
      candidates.flatMap((candidate) => {
        const motion = this.pending.get(candidate.key);
        return motion ? [[candidate.key, motion] as const] : [];
      }),
    );
  }

  /** Atomically acknowledge an entrance before its DOM animation starts. */
  claim(key: string, token: string): boolean {
    if (this.pending.get(key)?.token !== token) return false;
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
