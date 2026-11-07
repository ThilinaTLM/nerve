/** Statistics, in-page long-task/frame recorders and CDP performance metrics. */
import type { Cdp } from "./cdp.ts";

// --- statistics -------------------------------------------------------------

export const median = (values: number[]): number => percentile(values, 50);

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[rank]!;
}

export const round = (value: number, digits = 1): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

// --- in-page instrumentation ------------------------------------------------

/**
 * Installs long-task and rAF-gap recorders on `window.__bench`. Times are
 * `performance.now()` values; `reset()` starts a fresh window.
 */
export const INSTRUMENT = `(() => {
  if (window.__bench) { window.__bench.reset(); return; }
  const b = (window.__bench = { longtasks: [], gaps: [], start: 0, frames: 0, last: 0 });
  b.reset = () => {
    b.longtasks = []; b.gaps = []; b.frames = 0; b.last = 0;
    b.start = performance.now();
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) b.longtasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: "longtask" });
  const tick = (now) => {
    if (b.last) { const gap = now - b.last; if (gap > 50) b.gaps.push({ at: now, gap }); }
    b.last = now; b.frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  b.reset();
})()`;

export interface FrameStats {
  count: number;
  totalMs: number;
  p90Ms: number;
  maxMs: number;
}

export const summarize = (durations: number[]): FrameStats => ({
  count: durations.length,
  totalMs: round(durations.reduce((a, b) => a + b, 0)),
  p90Ms: round(percentile(durations, 90)),
  maxMs: round(Math.max(0, ...durations)),
});

// --- CDP performance metrics -------------------------------------------------

export async function metrics(cdp: Cdp): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send<{
    metrics: { name: string; value: number }[];
  }>("Performance.getMetrics");
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

export function metricsDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const ms = (name: string) =>
    round(((after[name] ?? 0) - (before[name] ?? 0)) * 1000);
  const task = ms("TaskDuration");
  const script = ms("ScriptDuration");
  const layout = ms("LayoutDuration");
  const style = ms("RecalcStyleDuration");
  return {
    mainThreadTaskMs: task,
    scriptingMs: script,
    layoutMs: layout,
    styleMs: style,
    otherMainThreadMs: round(task - script - layout - style),
    layoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
    styleRecalcCount:
      (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
    jsHeapUsedMb: round((after.JSHeapUsedSize ?? 0) / 1048576),
  };
}
