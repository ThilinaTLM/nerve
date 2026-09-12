import {
  EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN,
  EXPLORE_MAX_CHILDREN_PER_RUN,
} from "@nervekit/contracts/agents";

export interface ExploreAdmissionBatch {
  acquire(signal?: AbortSignal, onQueued?: () => void): Promise<() => void>;
  finish(): void;
}

type Waiter = {
  key: string;
  state: AdmissionState;
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

/** Per-parent semantic limits plus fair, global active-child admission. */
export class WorkbenchExploreAdmission {
  private readonly states = new Map<string, AdmissionState>();
  private readonly queues = new Map<string, Waiter[]>();
  private readonly queueOrder: string[] = [];
  private globalActive = 0;
  private nextLocalId = 0;

  constructor(private readonly maxGlobalActive = 8) {
    if (!Number.isInteger(maxGlobalActive) || maxGlobalActive < 1) {
      throw new Error("Explore global concurrency must be a positive integer.");
    }
  }

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
    const queue = this.queues.get(parentRunId) ?? [];
    this.removeQueue(parentRunId);
    for (const waiter of queue) {
      this.detachAbort(waiter);
      waiter.reject(abortError());
    }
    this.drain();
  }

  private acquire(
    key: string,
    state: AdmissionState,
    signal?: AbortSignal,
    onQueued?: () => void,
  ): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { key, state, signal, resolve, reject };
      if (signal) {
        waiter.onAbort = () => {
          this.removeWaiter(waiter);
          this.detachAbort(waiter);
          reject(abortError());
          this.deleteLocalStateIfIdle(key, state);
          this.drain();
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      const queue = this.queues.get(key);
      if (queue) {
        queue.push(waiter);
      } else {
        this.queues.set(key, [waiter]);
        this.queueOrder.push(key);
      }
      const admittedImmediately =
        this.globalActive < this.maxGlobalActive &&
        state.active < EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN &&
        this.queueOrder[0] === key;
      if (!admittedImmediately) onQueued?.();
      this.drain();
    });
  }

  private drain(): void {
    while (
      this.globalActive < this.maxGlobalActive &&
      this.queueOrder.length > 0
    ) {
      let selectedIndex = -1;
      let selectedActive = Number.POSITIVE_INFINITY;
      for (const [index, candidateKey] of this.queueOrder.entries()) {
        const candidate = this.queues.get(candidateKey)?.[0];
        if (
          !candidate ||
          this.states.get(candidateKey) !== candidate.state ||
          candidate.state.active >= EXPLORE_MAX_ACTIVE_CHILDREN_PER_RUN
        ) {
          continue;
        }
        if (candidate.state.active < selectedActive) {
          selectedIndex = index;
          selectedActive = candidate.state.active;
        }
      }
      if (selectedIndex < 0) return;

      const key = this.queueOrder.splice(selectedIndex, 1)[0]!;
      const queue = this.queues.get(key)!;
      const waiter = queue.shift()!;
      if (queue.length > 0) this.queueOrder.push(key);
      else this.queues.delete(key);
      this.detachAbort(waiter);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      waiter.state.active += 1;
      this.globalActive += 1;
      waiter.resolve(this.releaseHandle(key, waiter.state));
    }
  }

  private releaseHandle(key: string, state: AdmissionState): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      this.globalActive = Math.max(0, this.globalActive - 1);
      this.drain();
      this.deleteLocalStateIfIdle(key, state);
    };
  }

  private removeWaiter(waiter: Waiter): void {
    const queue = this.queues.get(waiter.key);
    if (!queue) return;
    const index = queue.indexOf(waiter);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.removeQueue(waiter.key);
  }

  private removeQueue(key: string): void {
    this.queues.delete(key);
    for (let index = this.queueOrder.length - 1; index >= 0; index -= 1) {
      if (this.queueOrder[index] === key) this.queueOrder.splice(index, 1);
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
      !this.queues.has(key) &&
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
