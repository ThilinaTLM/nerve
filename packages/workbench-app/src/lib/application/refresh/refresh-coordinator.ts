export class RefreshCoordinator<Demand> {
  readonly #merge: (current: Demand | undefined, next: Demand) => Demand;
  readonly #execute: (demand: Demand) => Promise<void> | void;
  #pending?: Demand;
  #inFlight = false;
  #stopped = false;
  #waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> =
    [];

  constructor(options: {
    merge: (current: Demand | undefined, next: Demand) => Demand;
    execute: (demand: Demand) => Promise<void> | void;
  }) {
    this.#merge = options.merge;
    this.#execute = options.execute;
  }

  request(demand: Demand): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#pending = this.#merge(this.#pending, demand);
    const completion = new Promise<void>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
    void this.#drain();
    return completion;
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#pending = undefined;
    for (const waiter of this.#waiters) waiter.resolve();
    this.#waiters = [];
  }

  async #drain(): Promise<void> {
    if (this.#stopped || this.#inFlight || this.#pending === undefined) return;
    const demand = this.#pending;
    const waiters = this.#waiters;
    this.#pending = undefined;
    this.#waiters = [];
    this.#inFlight = true;
    try {
      await this.#execute(demand);
      for (const waiter of waiters) waiter.resolve();
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
    } finally {
      this.#inFlight = false;
      void this.#drain();
    }
  }
}
