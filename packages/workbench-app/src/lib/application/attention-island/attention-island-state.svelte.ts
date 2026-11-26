import type {
  ConfigurationReview,
  ConfigurationReviewTarget,
} from "@nervekit/contracts/configuration";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import {
  collapseIsland,
  expandIsland,
  initialIslandState,
  laterIsland,
  observeConversations,
  observeTrust,
  pruneIsland,
  settleIsland,
  type IslandConversationKey,
  type IslandState,
} from "./attention-island";

/** How long an arrival shows before it settles into the bell. */
const ARRIVAL_MS = 4000;
/** After the pointer leaves an arrival it held. */
const ARRIVAL_AFTER_HOVER_MS = 2000;

/**
 * The bell island and the transcript marker share this state: one arrival
 * line, the Later choice (this session only) and the reviews behind the risk
 * lines. The lists themselves come from configuration attention and the
 * conversation inbox.
 */
class AttentionIslandController {
  state = $state<IslandState>(initialIslandState());
  /** Review summaries by item key; a failed read leaves the row without a risk line. */
  reviews = $state<Record<string, ConfigurationReview>>({});
  #hovered = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #reading = new Set<string>();

  #apply(next: IslandState): void {
    const before = this.state;
    if (next === before) return;
    this.state = next;
    const arrived =
      next.phase === "arrival" &&
      (before.phase !== "arrival" || before.arrival !== next.arrival);
    if (arrived) this.#arm(ARRIVAL_MS);
    else if (next.phase !== "arrival") clearTimeout(this.#timer);
  }

  #arm(ms: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (this.#hovered) return;
      this.#apply(settleIsland(this.state));
    }, ms);
  }

  observeTrust(scope: string, keys: readonly string[]): void {
    this.#apply(observeTrust(this.state, scope, keys));
  }

  observeConversations(
    items: readonly IslandConversationKey[],
    openConversationId: string | undefined,
  ): void {
    this.#apply(observeConversations(this.state, items, openConversationId));
  }

  prune(present: {
    trust: ReadonlySet<string>;
    conversations: ReadonlySet<string>;
  }): void {
    this.#apply(pruneIsland(this.state, present));
  }

  /** Hover holds an arrival; leaving lets it settle shortly after. */
  hover(hovered: boolean): void {
    this.#hovered = hovered;
    if (!hovered && this.state.phase === "arrival")
      this.#arm(ARRIVAL_AFTER_HOVER_MS);
  }

  expand(): void {
    this.#apply(expandIsland(this.state));
  }

  collapse(): void {
    this.#apply(collapseIsland(this.state));
  }

  /** Leaves the arrival or list for the review dialog or a conversation. */
  dismiss(): void {
    if (this.state.phase === "later") return;
    this.#apply({
      ...this.state,
      phase: "compact",
      arrival: undefined,
      queue: [],
    });
  }

  later(): void {
    this.#apply(laterIsland(this.state));
  }

  /**
   * Reads the review of each waiting item for its risk line and time. The
   * previous review stays shown until the new one arrives; items no longer
   * waiting are dropped.
   */
  readReviews(
    items: readonly { key: string; target: ConfigurationReviewTarget }[],
  ): void {
    const waiting = new Set(items.map((item) => item.key));
    if (Object.keys(this.reviews).some((key) => !waiting.has(key)))
      this.reviews = Object.fromEntries(
        Object.entries(this.reviews).filter(([key]) => waiting.has(key)),
      );
    for (const { key, target } of items) {
      if (this.#reading.has(key)) continue;
      this.#reading.add(key);
      void requestConversation("configuration.review", target)
        .then((review) => {
          this.reviews = { ...this.reviews, [key]: review };
        })
        .catch(() => undefined)
        .finally(() => this.#reading.delete(key));
    }
  }
}

export const attentionIsland = new AttentionIslandController();
