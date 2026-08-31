/**
 * Tracks the storage page's mount lifecycle so a controller instance that is
 * reused across mounts can restart cleanly and ignore responses belonging to a
 * previous run.
 */
export class StorageRunGuard {
  #runId = 0;
  #active = false;

  /** Begins a new run and returns its id. */
  begin(): number {
    this.#runId += 1;
    this.#active = true;
    return this.#runId;
  }

  /** Ends the current run; later responses from it become stale. */
  end(): void {
    this.#runId += 1;
    this.#active = false;
  }

  get active(): boolean {
    return this.#active;
  }

  get currentRunId(): number {
    return this.#runId;
  }

  isStale(runId: number): boolean {
    return !this.#active || runId !== this.#runId;
  }
}
