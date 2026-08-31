import {
  EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN,
  EXPLORE_MAX_CHILDREN_PER_RUN,
} from "@nervekit/contracts/agents";

export interface ExploreAdmissionBatch {
  acquire(signal?: AbortSignal, onQueued?: () => void): Promise<() => void>;
  finish(): void;
}

type Waiter = {
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
};

type AdmissionState = {
  active: number;
  used: number;
  batches: number;
  local: boolean;
  queue: Waiter[];
};

export class ExploreRunLimitError extends Error {
  constructor(
    readonly requested: number,
    readonly used: number,
    readonly remaining: number,
  ) {
    super(exploreRunLimitMessage(requested, used, remaining));
    this.name = "ExploreRunLimitError";
  }
}

/** Runtime-only Explore limits keyed by the owning parent run. */
export class WorkbenchExploreAdmission {
  private readonly states = new Map<string, AdmissionState>();
  private nextLocalId = 0;

  reserveBatch(
    parentRunId: string | undefined,
    taskCount: number,
  ): ExploreAdmissionBatch {
    const key =
      parentRunId ?? `local-explore-${this.nextLocalId++}-${Date.now()}`;
    const state = this.states.get(key) ?? {
      active: 0,
      used: 0,
      batches: 0,
      local: parentRunId === undefined,
      queue: [],
    };
    const remaining = EXPLORE_MAX_CHILDREN_PER_RUN - state.used;
    if (taskCount > remaining) {
      throw new ExploreRunLimitError(taskCount, state.used, remaining);
    }
    state.used += taskCount;
    state.batches += 1;
    this.states.set(key, state);

    let finished = false;
    return {
      acquire: (signal, onQueued) => this.acquire(key, state, signal, onQueued),
      finish: () => {
        if (finished) return;
        finished = true;
        state.batches -= 1;
        this.deleteLocalStateIfIdle(key, state);
      },
    };
  }

  clearRun(parentRunId: string): void {
    const state = this.states.get(parentRunId);
    if (!state) return;
    this.states.delete(parentRunId);
    for (const waiter of state.queue.splice(0)) {
      this.detachAbort(waiter);
      waiter.reject(abortError());
    }
  }

  private acquire(
    key: string,
    state: AdmissionState,
    signal?: AbortSignal,
    onQueued?: () => void,
  ): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (
      this.states.get(key) === state &&
      state.active < EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN &&
      state.queue.length === 0
    ) {
      state.active += 1;
      return Promise.resolve(this.releaseHandle(key, state));
    }

    onQueued?.();
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject };
      if (signal) {
        waiter.onAbort = () => {
          const index = state.queue.indexOf(waiter);
          if (index >= 0) state.queue.splice(index, 1);
          this.detachAbort(waiter);
          reject(abortError());
          this.deleteLocalStateIfIdle(key, state);
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      state.queue.push(waiter);
      this.drain(key, state);
    });
  }

  private releaseHandle(key: string, state: AdmissionState): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      this.drain(key, state);
      this.deleteLocalStateIfIdle(key, state);
    };
  }

  private drain(key: string, state: AdmissionState): void {
    if (this.states.get(key) !== state) return;
    while (
      state.active < EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN &&
      state.queue.length > 0
    ) {
      const waiter = state.queue.shift()!;
      this.detachAbort(waiter);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      state.active += 1;
      waiter.resolve(this.releaseHandle(key, state));
    }
  }

  private detachAbort(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }

  private deleteLocalStateIfIdle(key: string, state: AdmissionState): void {
    if (
      state.local &&
      state.active === 0 &&
      state.queue.length === 0 &&
      state.batches === 0
    ) {
      this.states.delete(key);
    }
  }
}

function exploreRunLimitMessage(
  requested: number,
  used: number,
  remaining: number,
): string {
  const base = `Explore run limit reached: requested ${requested} child agents, but only ${remaining} of ${EXPLORE_MAX_CHILDREN_PER_RUN} launches remain (${used} used). No children were started for this call.`;
  return remaining > 0
    ? `${base} Retry with at most ${remaining} tasks, or continue directly with read/grep/find/ls.`
    : `${base} Explore is unavailable for the remainder of this parent run; continue directly with read/grep/find/ls. The allowance resets on the next parent run.`;
}

function abortError(): Error {
  const error = new Error("Agent run aborted.");
  error.name = "AbortError";
  return error;
}
