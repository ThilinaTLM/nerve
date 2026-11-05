export interface FailureLimiterOptions {
  /** Failures allowed per key inside `windowMs`. */
  perKey: number;
  /** Failures allowed across all keys inside `windowMs`. */
  global: number;
  windowMs: number;
  /** First lockout once a limit is hit; doubles per repeat up to `maxBlockMs`. */
  baseBlockMs?: number;
  maxBlockMs?: number;
  now?: () => number;
}

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

interface Bucket {
  failures: number[];
  strikes: number;
  blockedUntil: number;
}

/**
 * In-memory sliding-window failure counter with exponential backoff.
 * Counters are never persisted: a daemon restart resets them.
 */
export class FailureLimiter {
  readonly #options: Required<FailureLimiterOptions>;
  readonly #keys = new Map<string, Bucket>();
  readonly #global: Bucket = { failures: [], strikes: 0, blockedUntil: 0 };

  constructor(options: FailureLimiterOptions) {
    this.#options = {
      baseBlockMs: 30_000,
      maxBlockMs: 60 * 60_000,
      now: Date.now,
      ...options,
    };
  }

  check(key: string): LimitDecision {
    const now = this.#options.now();
    const bucket = this.#keys.get(key);
    const until = Math.max(
      bucket?.blockedUntil ?? 0,
      this.#global.blockedUntil,
    );
    if (until > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((until - now) / 1000),
      };
    }
    return { allowed: true };
  }

  recordFailure(key: string): void {
    const now = this.#options.now();
    const bucket = this.#bucket(key);
    this.#add(bucket, this.#options.perKey, now);
    this.#add(this.#global, this.#options.global, now);
    this.#sweep(now);
  }

  recordSuccess(key: string): void {
    this.#keys.delete(key);
  }

  #bucket(key: string): Bucket {
    let bucket = this.#keys.get(key);
    if (!bucket) {
      bucket = { failures: [], strikes: 0, blockedUntil: 0 };
      this.#keys.set(key, bucket);
    }
    return bucket;
  }

  #add(bucket: Bucket, limit: number, now: number): void {
    const cutoff = now - this.#options.windowMs;
    bucket.failures = bucket.failures.filter((at) => at > cutoff);
    bucket.failures.push(now);
    if (bucket.failures.length < limit) return;
    const block = Math.min(
      this.#options.baseBlockMs * 2 ** bucket.strikes,
      this.#options.maxBlockMs,
    );
    bucket.strikes += 1;
    bucket.blockedUntil = now + block;
    bucket.failures = [];
  }

  #sweep(now: number): void {
    if (this.#keys.size < 1024) return;
    const cutoff = now - this.#options.windowMs - this.#options.maxBlockMs;
    for (const [key, bucket] of this.#keys) {
      const last = bucket.failures.at(-1) ?? 0;
      if (Math.max(last, bucket.blockedUntil) < cutoff) this.#keys.delete(key);
    }
  }
}
