import { revealLines } from "./primitives";
import { q } from "./runtime";

/* Closing call to action.
 *
 * The headline arrives line by line. The signal on the platform line is a CSS
 * loop (`ClosingCta.astro`), so it needs nothing from the stage. */
export function closingStage(): void {
  const closing = q(".closing");
  if (!closing) return;

  revealLines(q("#closing-title", closing));
}
