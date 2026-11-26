import type {
  ConfigurationReview,
  ConfigurationReviewTarget,
} from "@nervekit/contracts/configuration";
import {
  configurationReviewQueue,
  protocolReviewApi,
} from "./configuration-review-queue.svelte";
import {
  decideReviewed,
  STALE_REVIEW_NOTICE,
  type ConfigurationReviewApi,
  type ConfigurationReviewQueue,
} from "./review-queue";
import { sameReviewTarget } from "./review-target-page";

export type ConfigurationItemReviewPhase = "loading" | "ready" | "error";

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * The review of one item on its Settings page: the "What it can do" and
 * "Source" sections and the decision callout. Trust opens the review dialog
 * as confirmation; Decline and Revoke decide here on the content shown.
 */
export class ConfigurationItemReview {
  phase = $state<ConfigurationItemReviewPhase>("loading");
  review = $state<ConfigurationReview>();
  error = $state<string>();
  notice = $state<string>();
  busy = $state(false);
  #request = 0;

  constructor(
    readonly target: ConfigurationReviewTarget,
    private readonly api: ConfigurationReviewApi = protocolReviewApi,
    private readonly queue: ConfigurationReviewQueue = configurationReviewQueue,
  ) {}

  /** Loads the review and follows decisions made in any window; returns the cleanup. */
  start(): () => void {
    void this.load();
    return this.queue.onDecision((decided) => {
      if (
        sameReviewTarget(decided.target, this.target) &&
        decided.state !== this.review?.state
      ) {
        this.notice = undefined;
        void this.load();
      }
    });
  }

  async load(): Promise<void> {
    const request = ++this.#request;
    this.error = undefined;
    try {
      const review = await this.api.review(this.target);
      if (request !== this.#request) return;
      this.review = review;
      this.phase = "ready";
    } catch (error) {
      if (request !== this.#request) return;
      this.error = message(error, "Could not load the review.");
      this.phase = this.review ? "ready" : "error";
    }
  }

  /** Trust is confirmed in the review dialog, on the content it shows. */
  trust(): void {
    this.queue.start([this.target]);
  }

  /** Declines a waiting item, or revokes a trusted one. */
  async decline(): Promise<void> {
    const shown = this.review;
    if (!shown || this.busy) return;
    this.busy = true;
    this.error = undefined;
    this.notice = undefined;
    const outcome = await decideReviewed(this.api, shown, false);
    this.busy = false;
    if (outcome.status === "failed") {
      this.error = outcome.error;
      return;
    }
    this.review = outcome.review;
    if (outcome.status === "stale") this.notice = STALE_REVIEW_NOTICE;
    else this.queue.announce(outcome.review);
  }
}
