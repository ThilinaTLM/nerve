export interface ReconnectPolicyOptions {
  readonly initialDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly multiplier?: number;
  readonly jitter?: number;
  readonly maximumAttempts?: number;
}

export class ReconnectPolicy {
  readonly #initial: number;
  readonly #maximum: number;
  readonly #multiplier: number;
  readonly #jitter: number;
  readonly #maximumAttempts: number;

  constructor(options: ReconnectPolicyOptions = {}) {
    this.#initial = options.initialDelayMs ?? 250;
    this.#maximum = options.maximumDelayMs ?? 30_000;
    this.#multiplier = options.multiplier ?? 2;
    this.#jitter = options.jitter ?? 0.2;
    this.#maximumAttempts = options.maximumAttempts ?? Number.POSITIVE_INFINITY;
  }

  delay(attempt: number, random = Math.random): number | undefined {
    if (attempt >= this.#maximumAttempts) return undefined;
    const base = Math.min(
      this.#maximum,
      this.#initial * this.#multiplier ** attempt,
    );
    const factor = 1 - this.#jitter + random() * this.#jitter * 2;
    return Math.max(0, Math.round(base * factor));
  }
}
