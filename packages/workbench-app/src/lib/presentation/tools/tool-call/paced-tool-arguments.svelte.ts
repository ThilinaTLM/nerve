import { untrack } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { StreamingRevealLoop } from "@nervekit/ui-kit/scheduling/streaming-reveal-loop";
import type { ToolDraftViewModel } from "../../state/active-run";
import {
  pacedDraftBlock,
  ToolArgumentHandoff,
} from "../views/tool-argument-reveal";

/**
 * Paced argument reveal. Streamed argument text is revealed at the same even
 * cadence as assistant text, upstream of every tool-specific parser, so
 * previews and counters advance smoothly. `applyToolDraftDone` clears
 * `argsText`, so the last streamed text is retained for the drain.
 *
 * Must be constructed during component initialisation (it registers effects).
 */
export class PacedToolArguments {
  readonly #handoff = new ToolArgumentHandoff();
  #source;
  // Starts fully revealed so remounts and virtual-row re-entry never replay.
  #revealedLength = $state(0);
  #pacing;
  #settled;
  #block;

  constructor(deps: {
    draft: () => ToolDraftViewModel | undefined;
    hasToolCall: () => boolean;
    argsPreview: () => unknown;
    /** Whether the body is hydrated, so pacing is worth running. */
    hydrated: () => boolean;
  }) {
    this.#source = $derived(
      this.#handoff.update(
        deps.draft()?.block,
        deps.hasToolCall(),
        deps.argsPreview() ?? deps.draft()?.block.args,
      ),
    );
    const initialLength = untrack(() => this.#source.text.length);
    this.#revealedLength = initialLength;
    const loop = new StreamingRevealLoop(initialLength, {
      onReveal: (length) => {
        this.#revealedLength = length;
      },
    });
    this.#pacing = $derived(
      Boolean(this.#source.block) &&
        deps.hydrated() &&
        !prefersReducedMotion.current,
    );
    $effect(() => {
      const length = this.#source.text.length;
      const done = this.#source.done;
      if (!this.#pacing) {
        loop.snap(length);
        this.#revealedLength = length;
        return;
      }
      loop.setTarget(length, { done });
    });
    $effect(() => () => loop.destroy());
    this.#settled = $derived(
      this.#source.done && this.#revealedLength >= this.#source.text.length,
    );
    this.#block = $derived(
      this.#source.block
        ? pacedDraftBlock(
            this.#source.block,
            this.#source.text,
            this.#revealedLength,
            this.#settled,
          )
        : undefined,
    );
  }

  /** The streamed argument text, complete once the stream has finished. */
  get text(): string {
    return this.#source.text;
  }

  /** The reveal has caught up with a finished stream. */
  get settled(): boolean {
    return this.#settled;
  }

  /** The draft block as revealed so far. */
  get block() {
    return this.#block;
  }

  /**
   * True while a draft still owns presentation: the durable record takes over
   * only after the reveal drains (bounded by the pacer's lag and flush limits),
   * so nothing pops in.
   */
  get draining(): boolean {
    return Boolean(this.#source.block) && !this.#settled;
  }
}
