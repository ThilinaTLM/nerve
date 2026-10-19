import type { NativeSearchIndexHandle } from "./binding.js";

/** One bounded lane across reads and updates; revisions cannot interleave mid-update. */
export function createLane(handle: Pick<NativeSearchIndexHandle, "close">) {
  const cancellation = new AbortController();
  let closed = false;
  let closing: Promise<void> | undefined;
  let active: Promise<void> | undefined;
  const queue: { execute(): Promise<void>; reject(error: Error): void }[] = [];
  const check = () => {
    if (closed) throw new Error("Completion index is closed");
  };
  function pump() {
    if (closed || active || !queue.length) return;
    const request = queue.shift()!;
    active = request.execute().finally(() => {
      active = undefined;
      pump();
    });
  }
  return {
    check,
    capacity() {
      check();
      if (queue.length >= 32) throw new Error("Completion index queue is full");
    },
    signal: cancellation.signal,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      check();
      if (queue.length >= 32) throw new Error("Completion index queue is full");
      return new Promise<T>((resolve, reject) => {
        queue.push({
          reject,
          async execute() {
            try {
              resolve(await operation());
            } catch (error) {
              reject(error);
            }
          },
        });
        pump();
      });
    },
    async close() {
      if (!closing) {
        closed = true;
        cancellation.abort();
        const disposal = handle.close();
        for (const request of queue.splice(0))
          request.reject(new Error("Completion index is closed"));
        closing = Promise.all([disposal, active]).then(() => undefined);
      }
      await closing;
    },
  };
}
