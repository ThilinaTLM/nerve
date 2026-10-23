import { setImmediate } from "node:timers/promises";
import type { StepContext } from "../../framework/step.js";

/** Counts are local to each phase, not an estimate of overall migration time.
 * Yield after publishing so lifecycle polling can serve synchronous file/SQL work.
 */
export function phaseProgress(
  ctx: StepContext,
  phase: string,
  label: string,
  total?: number,
) {
  let last = -Infinity;
  let lastDone = -1;
  return async (done = 0): Promise<void> => {
    const now = performance.now();
    if (done === lastDone) return;
    if (done !== 0 && done !== total && now - last < 250) return;
    last = now;
    lastDone = done;
    ctx.progress(phase, total === undefined ? undefined : done, total, label);
    await setImmediate();
  };
}
