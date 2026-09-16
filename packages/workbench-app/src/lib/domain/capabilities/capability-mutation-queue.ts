/**
 * Capability writes use optimistic concurrency on the document digest, so two
 * toggles in flight at once either conflict or land out of order and appear to
 * revert in the UI. Mutations therefore run strictly in submission order, each
 * starting only after the previous one applied its echoed configuration.
 */
export type CapabilityMutationQueue = {
  run<T>(mutation: () => Promise<T>): Promise<T>;
  /** Resolves once the queue is idle; useful for tests and reload guards. */
  settled(): Promise<void>;
};

export function createCapabilityMutationQueue(): CapabilityMutationQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(mutation: () => Promise<T>): Promise<T> {
      const next = tail.then(mutation, mutation);
      tail = next.catch(() => undefined);
      return next;
    },
    async settled(): Promise<void> {
      await tail;
    },
  };
}
