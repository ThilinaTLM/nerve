/** Scenario B: streaming run with long-task, frame-gap and CPU profile capture. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Cdp,
  click,
  pressEnter,
  sleep,
  typeText,
  waitFor,
} from "./cdp.ts";
import type { Flags } from "./flags.ts";
import {
  INSTRUMENT,
  metrics,
  metricsDelta,
  round,
  summarize,
} from "./measure.ts";
import { NetworkCapture } from "./network.ts";
import { selectProject } from "./open.ts";

export const DEFAULT_PROMPT = (dir: string) =>
  `Create a new folder ${dir} in the project root and build a small Python CLI todo app there: a todo.py module with add/list/done/remove commands storing JSON, a README.md, and unit tests in test_todo.py. Run the tests with python3 -m unittest and fix any failures. Then use grep and read to review your own code, and finish with a short summary. Work step by step with separate tool calls; keep the todo list updated as you go.`;

export interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  children?: number[];
}

export interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

export function selfTimes(
  profile: CpuProfile,
): { name: string; location: string; selfMs: number }[] {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const totals = new Map<
    string,
    { name: string; location: string; selfMs: number }
  >();
  profile.samples.forEach((id, index) => {
    const node = byId.get(id)!;
    const f = node.callFrame;
    const name = f.functionName || "(anonymous)";
    const location = f.url
      ? `${f.url.replace(/^https?:\/\/[^/]+\/assets\//, "")}:${f.lineNumber + 1}:${f.columnNumber + 1}`
      : "";
    const key = `${name}@${location}`;
    const entry = totals.get(key) ?? { name, location, selfMs: 0 };
    entry.selfMs += (profile.timeDeltas[index] ?? 0) / 1000;
    totals.set(key, entry);
  });
  return [...totals.values()].sort((a, b) => b.selfMs - a.selfMs);
}

export async function streamOnce(
  cdp: Cdp,
  flags: Flags,
  index: number,
): Promise<Record<string, unknown>> {
  await selectProject(cdp, flags.project);
  await click(cdp, `button[aria-label="New chat"]`);
  await sleep(1000);
  const composer = `.cm-content`;
  await waitFor(cdp, `document.querySelector('${composer}')`, "composer");
  await click(cdp, `button[aria-label="Model and thinking level"]`);
  await sleep(500);
  await click(cdp, `[role="option"], button, [data-slot]`, flags.model);
  await sleep(500);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
  await sleep(300);
  const chosen = await cdp.evaluate<string>(
    `[...document.querySelectorAll('button[aria-label="Model and thinking level"]')].find((b) => b.getBoundingClientRect().width > 0)?.textContent.trim() ?? ""`,
  );
  console.log(`model button: ${chosen}`);
  await click(cdp, composer);
  const dir = `qa-sandbox-bench-${Date.now()}`;
  await typeText(cdp, flags.prompt ?? DEFAULT_PROMPT(dir));
  await cdp.evaluate(INSTRUMENT);
  const capture = new NetworkCapture(cdp, flags.noNetwork);
  await capture.start();
  if (flags.profile) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
  }
  const trace = flags.trace ? await startTrace(cdp) : undefined;
  const before = await metrics(cdp);
  const startedAt = Date.now();
  await cdp.evaluate(`window.__bench.reset()`);
  await pressEnter(cdp);
  // Running = a visible stop/cancel/interrupt control; done = it is gone again.
  await sleep(3000);
  let sawRunning = false;
  let lastLabels = "";
  const deadline = Date.now() + flags.timeoutSec * 1000;
  while (Date.now() < deadline) {
    const labels = await cdp.evaluate<
      string[]
    >(`[...document.querySelectorAll("button[aria-label]")]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => b.getAttribute("aria-label"))
      .filter((l) => /^(send|stop|cancel|interrupt|abort|queue)/i.test(l))`);
    const joined = labels.join(" | ");
    if (joined !== lastLabels) {
      console.log(
        `  [${((Date.now() - startedAt) / 1000).toFixed(1)}s] composer controls: ${joined}`,
      );
      lastLabels = joined;
    }
    const running = labels.some((l) =>
      /^(stop|cancel|interrupt|abort)/i.test(l),
    );
    if (running) sawRunning = true;
    if (sawRunning && !running) break;
    await sleep(500);
  }
  const wallMs = Date.now() - startedAt;
  const after = await metrics(cdp);
  const bench = await cdp.evaluate<{
    longtasks: { start: number; duration: number }[];
    gaps: { at: number; gap: number }[];
    frames: number;
    start: number;
  }>(`window.__bench`);
  let top: ReturnType<typeof selfTimes> = [];
  if (flags.profile) {
    const { profile } = await cdp.send<{ profile: CpuProfile }>(
      "Profiler.stop",
    );
    writeFileSync(
      join(flags.out, `stream-${index}.cpuprofile`),
      JSON.stringify(profile),
    );
    top = selfTimes(profile)
      .slice(0, 40)
      .map((e) => ({ ...e, selfMs: round(e.selfMs) }));
  }
  if (trace)
    writeFileSync(
      join(flags.out, `stream-${index}.trace.json`),
      JSON.stringify({ traceEvents: await trace() }),
    );
  const network = capture.stop();
  const longs = summarize(bench.longtasks.map((t) => t.duration));
  const gaps = summarize(bench.gaps.map((g) => g.gap));
  return {
    run: index + 1,
    wallSeconds: round(wallMs / 1000),
    sawRunning,
    longTasks: longs,
    longTaskShareOfWall: round((longs.totalMs / wallMs) * 100),
    longTasksOver100ms: bench.longtasks.filter((t) => t.duration > 100).length,
    frameGaps: {
      count: gaps.count,
      maxMs: gaps.maxMs,
      p90Ms: gaps.p90Ms,
      // Relative to the prompt submit, so gaps can be lined up with traces.
      at: bench.gaps.map((g) => ({
        atMs: round(g.at - bench.start),
        gapMs: round(g.gap),
      })),
    },
    frames: bench.frames,
    split: metricsDelta(before, after),
    network: {
      requests: network.requests,
      webSocketFramesReceived: network.webSocketFramesReceived,
      webSocketBytesReceived: network.webSocketBytesReceived,
    },
    scratchDir: dir,
    topSelfTime: top,
  };
}

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "v8",
  "v8.gc",
  "blink.user_timing",
  "toplevel",
];

/** Starts tracing; the returned function stops it and resolves the events. */
async function startTrace(cdp: Cdp): Promise<() => Promise<unknown[]>> {
  const events: unknown[] = [];
  const off = cdp.on<{ value: unknown[] }>("Tracing.dataCollected", (data) =>
    events.push(...data.value),
  );
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { includedCategories: TRACE_CATEGORIES },
  });
  return async () => {
    const done = new Promise<void>((resolve) => {
      const offDone = cdp.on("Tracing.tracingComplete", () => {
        offDone();
        resolve();
      });
    });
    await cdp.send("Tracing.end");
    await done;
    off();
    return events;
  };
}

export async function streamScenario(cdp: Cdp, flags: Flags): Promise<unknown> {
  const runs = [];
  for (let i = 0; i < flags.runs; i++) {
    const run = await streamOnce(cdp, flags, i);
    console.log(
      `run ${i + 1}:`,
      JSON.stringify({ ...run, topSelfTime: undefined }),
    );
    runs.push(run);
  }
  return { scenario: "stream", runs };
}
