import type {
  ConfigurationDecidedEvent,
  ConfigurationReview,
  ConfigurationReviewTarget,
} from "@nervekit/contracts/configuration";
import { reviewTargetKey, sameReviewTarget } from "./review-target-page";

export type ConfigurationReviewPhase = "idle" | "loading" | "ready" | "error";

/** Reads and decides one item: the review's only effects, replaceable in tests. */
export type ConfigurationReviewApi = {
  review(target: ConfigurationReviewTarget): Promise<ConfigurationReview>;
  decide(input: {
    target: ConfigurationReviewTarget;
    digest: string;
    trusted: boolean;
  }): Promise<ConfigurationReview>;
};

/**
 * Told after every decision, made here or in another window (`configuration.decided`),
 * so whatever shows the item reloads it.
 */
export type ConfigurationDecisionListener = (
  decided: ConfigurationDecidedEvent,
) => void;

const decisionKey = (decided: ConfigurationDecidedEvent) =>
  `${reviewTargetKey(decided.target)}\u0000${decided.state}`;

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export type DecisionOutcome =
  | { status: "decided"; review: ConfigurationReview }
  | { status: "stale"; review: ConfigurationReview }
  | { status: "failed"; error: string };

/**
 * Decides on exactly the reviewed content. A refusal is usually a stale
 * digest: then the current review comes back to be shown instead.
 */
export async function decideReviewed(
  api: ConfigurationReviewApi,
  shown: ConfigurationReview,
  trusted: boolean,
): Promise<DecisionOutcome> {
  try {
    const review = await api.decide({
      target: shown.target,
      digest: shown.digest,
      trusted,
    });
    return { status: "decided", review };
  } catch (error) {
    const current = await api.review(shown.target).catch(() => undefined);
    return current && current.digest !== shown.digest
      ? { status: "stale", review: current }
      : {
          status: "failed",
          error: message(error, "Could not save your decision."),
        };
  }
}

export const STALE_REVIEW_NOTICE =
  "It changed while you were reviewing it. Review it again before you decide.";

/** What the dialog shows. Pass a `$state` object to make it reactive. */
export type ReviewQueueFields = {
  targets: ConfigurationReviewTarget[];
  index: number;
  phase: ConfigurationReviewPhase;
  review: ConfigurationReview | undefined;
  /** Loading or deciding failed. */
  error: string | undefined;
  /** The item changed under the user; the new review is shown instead of deciding. */
  notice: string | undefined;
  busy: boolean;
};

export function emptyReviewQueueFields(): ReviewQueueFields {
  return {
    targets: [],
    index: 0,
    phase: "idle",
    review: undefined,
    error: undefined,
    notice: undefined,
    busy: false,
  };
}

/**
 * The one review dialog's state: a queue of items, the review of the current
 * one, and the decision on exactly the content the user was shown.
 */
export class ConfigurationReviewQueue {
  #request = 0;
  #listeners = new Set<ConfigurationDecisionListener>();
  /** Decisions made in this window whose `configuration.decided` echo is still to come. */
  #echoes = new Set<string>();

  constructor(
    private readonly fields: ReviewQueueFields,
    private readonly api: ConfigurationReviewApi,
    private readonly afterDecision: () => void | Promise<void> = () => {},
  ) {}

  get targets(): readonly ConfigurationReviewTarget[] {
    return this.fields.targets;
  }
  get index(): number {
    return this.fields.index;
  }
  get phase(): ConfigurationReviewPhase {
    return this.fields.phase;
  }
  get review(): ConfigurationReview | undefined {
    return this.fields.review;
  }
  get error(): string | undefined {
    return this.fields.error;
  }
  get notice(): string | undefined {
    return this.fields.notice;
  }
  get busy(): boolean {
    return this.fields.busy;
  }

  get open(): boolean {
    return this.fields.targets.length > 0;
  }

  get current(): ConfigurationReviewTarget | undefined {
    return this.fields.targets[this.fields.index];
  }

  get hasPrevious(): boolean {
    return this.fields.index > 0;
  }

  get hasNext(): boolean {
    return this.fields.index < this.fields.targets.length - 1;
  }

  /** Opens the dialog on `targets` (duplicates dropped), at `startIndex`. */
  start(targets: readonly ConfigurationReviewTarget[], startIndex = 0): void {
    const seen = new Set<string>();
    const unique = targets.filter((target) => {
      const key = reviewTargetKey(target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!unique.length) return this.close();
    this.fields.targets = unique;
    this.#show(Math.min(Math.max(0, startIndex), unique.length - 1));
  }

  close(): void {
    this.#request++;
    Object.assign(this.fields, emptyReviewQueueFields());
  }

  previous(): void {
    if (this.hasPrevious) this.#show(this.fields.index - 1);
  }

  next(): void {
    if (this.hasNext) this.#show(this.fields.index + 1);
  }

  /** Not now: the item stays as it is; the next one shows, or the dialog closes after the last. */
  skip(): void {
    if (this.hasNext) this.#show(this.fields.index + 1);
    else this.close();
  }

  /** Reads the current item again (Retry). */
  async reload(): Promise<void> {
    const target = this.current;
    if (!target) return;
    const request = ++this.#request;
    const fields = this.fields;
    if (!fields.review) fields.phase = "loading";
    fields.error = undefined;
    try {
      const review = await this.api.review(target);
      if (request !== this.#request) return;
      fields.review = review;
      fields.phase = "ready";
    } catch (error) {
      if (request !== this.#request) return;
      fields.review = undefined;
      fields.error = message(error, "Could not load the review.");
      fields.phase = "error";
    }
  }

  trust(): Promise<void> {
    return this.#decide(true);
  }

  /** Declines a waiting item, or revokes a trusted one. */
  decline(): Promise<void> {
    return this.#decide(false);
  }

  /** Called after each decision with the item's new review; returns the unsubscribe. */
  onDecision(listener: ConfigurationDecisionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A decision made in this window (the dialog or a page's Decline): refresh at once. */
  announce(review: ConfigurationReview): void {
    const decided = { target: review.target, state: review.state };
    this.#echoes.add(decisionKey(decided));
    this.#notify(decided);
  }

  /**
   * `configuration.decided` from the daemon: a decision in any window or device. The echo
   * of one made here was already handled by `announce`.
   */
  received(decided: ConfigurationDecidedEvent): void {
    if (this.#echoes.delete(decisionKey(decided))) return;
    this.#notify(decided);
  }

  #notify(decided: ConfigurationDecidedEvent): void {
    for (const listener of this.#listeners) listener(decided);
    void Promise.resolve(this.afterDecision()).catch(() => {});
  }

  /** The item is part of the open queue. */
  includes(target: ConfigurationReviewTarget): boolean {
    return this.fields.targets.some((entry) => sameReviewTarget(entry, target));
  }

  #show(index: number): void {
    Object.assign(this.fields, {
      index,
      review: undefined,
      error: undefined,
      notice: undefined,
      busy: false,
      phase: "loading",
    });
    void this.reload();
  }

  async #decide(trusted: boolean): Promise<void> {
    const fields = this.fields;
    const shown = fields.review;
    if (!shown || fields.busy) return;
    fields.busy = true;
    fields.error = undefined;
    fields.notice = undefined;
    const request = this.#request;
    const outcome = await decideReviewed(this.api, shown, trusted);
    if (outcome.status === "decided") this.announce(outcome.review);
    if (request !== this.#request) return;
    fields.busy = false;
    if (outcome.status === "decided") this.skip();
    else if (outcome.status === "stale") {
      fields.review = outcome.review;
      fields.notice = STALE_REVIEW_NOTICE;
    } else fields.error = outcome.error;
  }
}
