export interface LifecycleScope {
  readonly generation: number;
  /** True until the owning lifecycle is disposed or restarted. */
  isCurrent(): boolean;
  /** Registers teardown (unsubscribe, clearTimeout, poll.stop()); runs immediately if already superseded. */
  onDispose(cleanup: () => void): void;
  /** Resolves `undefined` instead of the value when the scope was superseded meanwhile. */
  guard<T>(promise: Promise<T>): Promise<T | undefined>;
}

/**
 * Lifecycle-only shell for controllers: idempotent start, teardown registry and
 * a generation that invalidates in-flight async work. Controllers compose it;
 * reconciliation stays in the controller.
 */
export class ControllerLifecycle {
  #generation = 0;
  #started = false;
  #cleanups: Array<() => void> = [];

  get started(): boolean {
    return this.#started;
  }

  /** Runs `setup` unless already started. Returns false when it was a no-op. */
  start(setup: (scope: LifecycleScope) => void): boolean {
    if (this.#started) return false;
    this.#begin(setup);
    return true;
  }

  /** Disposes any current scope, then starts a fresh one. */
  restart(setup: (scope: LifecycleScope) => void): void {
    this.dispose();
    this.#begin(setup);
  }

  /** Invalidates the current scope and runs its cleanups (latest first). */
  dispose(): void {
    this.#started = false;
    this.#generation += 1;
    const cleanups = this.#cleanups.reverse();
    this.#cleanups = [];
    for (const cleanup of cleanups) cleanup();
  }

  /**
   * Captures the current generation for work that may begin before `start()`.
   * The returned check is false once the lifecycle has been disposed or restarted.
   */
  capture(): () => boolean {
    const generation = this.#generation;
    return () => generation === this.#generation;
  }

  #begin(setup: (scope: LifecycleScope) => void): void {
    this.#started = true;
    const generation = ++this.#generation;
    const isCurrent = () => this.#started && generation === this.#generation;
    setup({
      generation,
      isCurrent,
      onDispose: (cleanup) => {
        if (isCurrent()) this.#cleanups.push(cleanup);
        else cleanup();
      },
      guard: async (promise) => {
        const value = await promise;
        return isCurrent() ? value : undefined;
      },
    });
  }
}
