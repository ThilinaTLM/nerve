export type HighlightQueueLease<T> = {
  result: T | Promise<T | undefined> | undefined;
  release: () => void;
};

type QueueJob<T> = {
  key: string;
  leases: number;
  started: boolean;
  cancelled: boolean;
  promise: Promise<T | undefined>;
  resolve: (value: T | undefined) => void;
};

export type HighlightQueueOptions<T> = {
  load: (key: string) => Promise<T | undefined>;
  schedule: (start: () => void) => void;
  lookup: (key: string) => { hit: boolean; value?: T };
  store: (key: string, value: T) => void;
};

/** Single-concurrency work queue whose pending jobs are reference-counted. */
export function createHighlightQueue<T>(options: HighlightQueueOptions<T>): {
  acquire: (key: string) => HighlightQueueLease<T>;
} {
  const pending = new Map<string, QueueJob<T>>();
  const queued: QueueJob<T>[] = [];
  let active: QueueJob<T> | undefined;

  function finish(job: QueueJob<T>, value: T | undefined): void {
    if (value !== undefined) options.store(job.key, value);
    if (pending.get(job.key) === job) pending.delete(job.key);
    if (active === job) active = undefined;
    job.resolve(value);
    pump();
  }

  function pump(): void {
    if (active) return;
    const job = queued.shift();
    if (!job) return;
    if (job.cancelled || job.leases === 0) {
      pump();
      return;
    }

    active = job;
    try {
      options.schedule(() => {
        if (job.cancelled || job.leases === 0) {
          if (active === job) active = undefined;
          pump();
          return;
        }
        job.started = true;
        void options.load(job.key).then(
          (value) => finish(job, value),
          () => finish(job, undefined),
        );
      });
    } catch {
      finish(job, undefined);
    }
  }

  return {
    acquire(key) {
      const cached = options.lookup(key);
      if (cached.hit) {
        return { result: cached.value, release: () => undefined };
      }

      let job = pending.get(key);
      if (!job) {
        let resolve!: (value: T | undefined) => void;
        const promise = new Promise<T | undefined>((complete) => {
          resolve = complete;
        });
        job = {
          key,
          leases: 0,
          started: false,
          cancelled: false,
          promise,
          resolve,
        };
        pending.set(key, job);
        queued.push(job);
      }
      job.leases += 1;
      let released = false;

      pump();
      return {
        result: job.promise,
        release() {
          if (released) return;
          released = true;
          job.leases = Math.max(0, job.leases - 1);
          if (job.leases > 0 || job.started || job.cancelled) return;
          job.cancelled = true;
          if (pending.get(job.key) === job) pending.delete(job.key);
          if (active === job) active = undefined;
          job.resolve(undefined);
          pump();
        },
      };
    },
  };
}
