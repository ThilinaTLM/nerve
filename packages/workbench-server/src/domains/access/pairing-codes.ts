import { randomInt } from "node:crypto";
import type { PairingCode } from "@nervekit/contracts/access";
import { FailureLimiter, type LimitDecision } from "./failure-limiter.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const CODE_LENGTH = 8;
const MAX_GUESSES_PER_CODE = 5;
const WINDOW_MS = 10 * 60_000;

export type PairingPurposeKind = PairingCode["purpose"];

interface PendingCode {
  purpose: PairingPurposeKind;
  expiresAt: number;
  /** Failed redeems seen while this code was alive; it dies at five. */
  guesses: number;
}

export type RedeemResult =
  | { ok: true; purpose: PairingPurposeKind }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/** Canonical form: Crockford folding (O→0, I/L→1), no separators, upper case. */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * One-time pairing and setup codes. Memory only: a daemon restart invalidates
 * every pending code. A code is single use, short lived, dies after five
 * failed redeems anywhere while it is alive, and redeems are throttled per IP
 * and globally with exponential backoff.
 */
export class PairingCodes {
  readonly #codes = new Map<string, PendingCode>();
  readonly #limiter: FailureLimiter;
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#limiter = new FailureLimiter({
      perKey: 10,
      global: 30,
      windowMs: WINDOW_MS,
      now: this.#now,
    });
  }

  create(purpose: PairingPurposeKind, ttlSeconds: number): PairingCode {
    this.#expire();
    let code: string;
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        () => ALPHABET[randomInt(ALPHABET.length)],
      ).join("");
    } while (this.#codes.has(code));
    const expiresAt = this.#now() + ttlSeconds * 1000;
    this.#codes.set(code, { purpose, expiresAt, guesses: 0 });
    return { code: formatPairingCode(code), expiresAt, purpose };
  }

  /** Non-consuming check for the first step of a two-step flow (passkey registration). */
  peek(rawCode: string, ip: string, accepts: PairingPurposeKind): RedeemResult {
    return this.#resolve(rawCode, ip, accepts, false);
  }

  /** Validate and consume. `accepts` restricts the purpose (setup vs. pairing). */
  redeem(
    rawCode: string,
    ip: string,
    accepts: PairingPurposeKind | "pairing",
  ): RedeemResult {
    return this.#resolve(rawCode, ip, accepts, true);
  }

  #resolve(
    rawCode: string,
    ip: string,
    accepts: PairingPurposeKind | "pairing",
    consume: boolean,
  ): RedeemResult {
    this.#expire();
    const decision: LimitDecision = this.#limiter.check(ip);
    if (!decision.allowed) {
      return {
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }
    const code = normalizePairingCode(rawCode);
    const pending = this.#codes.get(code);
    const matches =
      pending !== undefined &&
      (accepts === "pairing"
        ? pending.purpose !== "setup"
        : pending.purpose === accepts);
    if (!pending || !matches) {
      this.#fail(ip);
      return { ok: false, reason: "invalid" };
    }
    if (consume) this.#codes.delete(code);
    this.#limiter.recordSuccess(ip);
    return { ok: true, purpose: pending.purpose };
  }

  /** Consume a previously peeked code. */
  consume(rawCode: string): boolean {
    return this.#codes.delete(normalizePairingCode(rawCode));
  }

  /** Throttle check without attempting a redeem. */
  check(ip: string): LimitDecision {
    return this.#limiter.check(ip);
  }

  get pending(): number {
    this.#expire();
    return this.#codes.size;
  }

  clear(): void {
    this.#codes.clear();
  }

  #fail(ip: string): void {
    this.#limiter.recordFailure(ip);
    for (const [code, pending] of this.#codes) {
      pending.guesses += 1;
      if (pending.guesses >= MAX_GUESSES_PER_CODE) this.#codes.delete(code);
    }
  }

  #expire(): void {
    const now = this.#now();
    for (const [code, pending] of this.#codes) {
      if (pending.expiresAt <= now) this.#codes.delete(code);
    }
  }
}
