import type { ConversationLiveToolDraftProgressSnapshot } from "@nervekit/contracts/conversations";
import type { ToolDraftProgressAccumulator } from "./tool-draft-progress.js";

const PUBLISH_INTERVAL_MS = 100;

export class ToolDraftProgressScheduler {
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly #publishedAt = new Map<number, number>();

  constructor(
    private readonly accumulators: Map<number, ToolDraftProgressAccumulator>,
    private readonly publish: (
      contentIndex: number,
      progress: ConversationLiveToolDraftProgressSnapshot,
    ) => void,
  ) {}

  schedule(contentIndex: number): void {
    const elapsed =
      performance.now() -
      (this.#publishedAt.get(contentIndex) ?? Number.NEGATIVE_INFINITY);
    if (elapsed >= PUBLISH_INTERVAL_MS) {
      this.#publishChanged(contentIndex);
      return;
    }
    if (this.#timers.has(contentIndex)) return;
    const timer = setTimeout(
      () => {
        this.#timers.delete(contentIndex);
        this.#publishChanged(contentIndex);
      },
      Math.max(0, PUBLISH_INTERVAL_MS - elapsed),
    );
    timer.unref?.();
    this.#timers.set(contentIndex, timer);
  }

  finish(contentIndex: number): void {
    const timer = this.#timers.get(contentIndex);
    if (timer) clearTimeout(timer);
    this.#timers.delete(contentIndex);
    this.#publishChanged(contentIndex);
    this.#publishedAt.delete(contentIndex);
    this.accumulators.delete(contentIndex);
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#publishedAt.clear();
    this.accumulators.clear();
  }

  #publishChanged(contentIndex: number): void {
    const progress = this.accumulators.get(contentIndex)?.takeChangedSnapshot();
    if (!progress) return;
    this.#publishedAt.set(contentIndex, performance.now());
    this.publish(contentIndex, progress);
  }
}
