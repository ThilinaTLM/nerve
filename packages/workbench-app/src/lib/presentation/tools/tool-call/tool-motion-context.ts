import { getContext, setContext } from "svelte";

/**
 * Streaming motion for one tool card, provided by ToolCallCard and read by
 * the leaf renderers (code blocks, output blocks, checklists, result lists)
 * so individual tool views need no motion props.
 */
export type ToolMotion = {
  /** Fade/slide/pace streamed content; off when the card claimed `minimal`. */
  readonly streamMotion: boolean;
  /** The result arrived all at once, live, in a calm moment: fade it in once. */
  readonly enter: boolean;
};

const TOOL_MOTION = Symbol("tool-motion");
const NO_MOTION: ToolMotion = { streamMotion: false, enter: false };

export function provideToolMotion(motion: ToolMotion): void {
  setContext(TOOL_MOTION, motion);
}

export function getToolMotion(): ToolMotion {
  return getContext<ToolMotion | undefined>(TOOL_MOTION) ?? NO_MOTION;
}

/** Stagger for result rows entering together; capped at the collapsed window. */
export function resultRowEnterDelay(index: number): string {
  return `${Math.min(index, 6) * 22}ms`;
}
