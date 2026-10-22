import { setImmediate } from "node:timers/promises";
import type { StepContext } from "../../framework/step.js";

/** Phase-local counts. Only the main conversation pass drives the meter;
 * subsequent safety phases are indeterminate rather than restarting it at zero.
 * Yield as well as publish: resolved unit promises alone starve lifecycle polling.
 */
export function phaseProgress(
  ctx: StepContext,
  phase: string,
  label: string,
  total?: number,
  meter = false,
) {
  let last = -Infinity;
  return async (done = 0): Promise<void> => {
    const now = performance.now();
    if (done !== 0 && done !== total && now - last < 250) return;
    last = now;
    ctx.progress(
      phase,
      meter ? done : undefined,
      meter ? total : undefined,
      total !== undefined && !meter ? `${label} · ${done} of ${total}` : label,
    );
    await setImmediate();
  };
}
