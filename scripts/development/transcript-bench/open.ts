/** Scenario A: open a large conversation and measure click → first row. */
import { CliError } from "../../cli/main.ts";
import { type Cdp, click, sleep, typeText, waitFor } from "./cdp.ts";
import type { Flags } from "./flags.ts";
import {
  INSTRUMENT,
  type FrameStats,
  median,
  metrics,
  metricsDelta,
  round,
  summarize,
} from "./measure.ts";
import { NetworkCapture, type NetworkSummary } from "./network.ts";

export const TRANSCRIPT = `[aria-label="Conversation transcript"]`;

export interface OpenRun {
  firstRowMs: number;
  settledLongTasks: FrameStats;
  longTasksBeforeFirstRow: FrameStats;
  split: Record<string, number>;
  network: NetworkSummary;
}

export async function selectProject(cdp: Cdp, project: string): Promise<void> {
  const selector = `button[aria-label=${JSON.stringify(project)}]`;
  await waitFor(
    cdp,
    `document.querySelector(${JSON.stringify(selector)})`,
    `project button ${project}`,
  );
  const pressed = await cdp.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-pressed")`,
  );
  if (pressed !== "true") {
    await click(cdp, selector);
    await waitFor(
      cdp,
      `document.querySelector(${JSON.stringify(selector)}).getAttribute("aria-pressed") === "true"`,
      `project ${project} to be active`,
    );
  }
  await sleep(500);
}

export async function setSearch(cdp: Cdp, text: string): Promise<void> {
  const input = `input[placeholder="Search conversations"]`;
  await click(cdp, input);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    modifiers: 2,
    commands: ["selectAll"],
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
  });
  if (text) await typeText(cdp, text);
  else
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
  await sleep(800);
}

export async function runOpenOnce(
  cdp: Cdp,
  options: {
    conversation: string;
    search: string;
    reload: boolean;
    project: string;
    noNetwork: boolean;
  },
): Promise<OpenRun> {
  const row = `[data-panel-row-id="${options.conversation}"]`;
  if (options.reload) {
    await cdp.send("Page.reload");
    await sleep(1500);
    await waitFor(
      cdp,
      `document.querySelector('${TRANSCRIPT}') || document.querySelector('input[placeholder="Search conversations"]')`,
      "app after reload",
      60_000,
    );
  }
  await selectProject(cdp, options.project);
  // Close the target's tab if it is open so it opens from the list again.
  await cdp.evaluate(`(() => {
    const close = document.querySelector('button[aria-label^="Close ${options.search.slice(0, 20).replace(/["'\\]/g, "")}"]');
    if (close) close.click();
  })()`);
  await sleep(500);
  await setSearch(cdp, "");
  // Open any other conversation first so the target replaces a real transcript.
  const fromRow = await cdp.evaluate<string | null>(`(() => {
    const rows = [...document.querySelectorAll("[data-panel-row-id]")];
    return rows.map((r) => r.getAttribute("data-panel-row-id")).find((id) => id?.startsWith("conv_") && id !== ${JSON.stringify(options.conversation)}) ?? null;
  })()`);
  if (!fromRow) throw new CliError("No other conversation to open first");
  await click(cdp, `[data-panel-row-id="${fromRow}"]`);
  await waitFor(
    cdp,
    `[...document.querySelectorAll('${TRANSCRIPT}')].some((v) => v.getBoundingClientRect().width > 0 && v.querySelector('.virtual-scroller-row'))`,
    "source conversation transcript",
    60_000,
  );
  await sleep(1500);
  await setSearch(cdp, options.search);
  await waitFor(
    cdp,
    `document.querySelector('${row}')`,
    `row ${options.conversation} after search`,
  );
  await sleep(500);

  await cdp.evaluate(INSTRUMENT);
  const capture = new NetworkCapture(cdp, options.noNetwork);
  await capture.start();
  // Arm: t0 on the click, first row = a transcript row whose key was not on
  // screen at click time and that is laid out inside the viewport.
  await cdp.evaluate(`(() => {
    const b = window.__bench;
    b.t0 = null; b.firstRow = null;
    b.done = new Promise((resolve) => {
      document.querySelector(${JSON.stringify(row)}).addEventListener("click", () => {
        b.t0 = performance.now();
        const rows = () => {
          const out = [];
          for (const view of document.querySelectorAll('${TRANSCRIPT}')) {
            const vr = view.getBoundingClientRect();
            if (vr.width === 0) continue; // inactive tab (hidden)
            for (const e of view.querySelectorAll(".virtual-scroller-row")) {
              const r = e.getBoundingClientRect();
              if (r.height > 0 && r.bottom > vr.top && r.top < vr.bottom) out.push(e.getAttribute("data-item-key"));
            }
          }
          return out;
        };
        const before = new Set(rows());
        const check = (now) => {
          if (rows().some((key) => !before.has(key))) { b.firstRow = now; return resolve(now - b.t0); }
          if (performance.now() - b.t0 > 30000) return resolve(-1);
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }, { capture: true, once: true });
    });
  })()`);
  const before = await metrics(cdp);
  capture.mark();
  await click(cdp, row);
  const firstRowMs = await cdp.evaluate<number>(`window.__bench.done`);
  const atFirstRow = await metrics(cdp);
  await sleep(2000); // settle: later long tasks belong to "after first row"
  const bench = await cdp.evaluate<{
    longtasks: { start: number; duration: number }[];
    t0: number;
    firstRow: number;
  }>(`window.__bench`);
  const network = capture.stop();
  const early = bench.longtasks.filter((t) => t.start < bench.firstRow);
  return {
    firstRowMs: round(firstRowMs),
    longTasksBeforeFirstRow: summarize(early.map((t) => t.duration)),
    settledLongTasks: summarize(
      bench.longtasks.filter((t) => t.start >= bench.t0).map((t) => t.duration),
    ),
    split: metricsDelta(before, atFirstRow),
    network,
  };
}

export async function openScenario(cdp: Cdp, flags: Flags): Promise<unknown> {
  const runs: OpenRun[] = [];
  for (let i = 0; i < flags.runs; i++) {
    const run = await runOpenOnce(cdp, {
      conversation: flags.conversation,
      search: flags.search,
      reload: flags.reload,
      project: flags.project,
      noNetwork: flags.noNetwork,
    });
    console.log(
      `run ${i + 1}: first row ${run.firstRowMs} ms`,
      JSON.stringify(run.split),
      `requests=${run.network.requests} ws-frames-in=${run.network.webSocketFramesReceived}`,
    );
    runs.push(run);
  }
  const med = (pick: (run: OpenRun) => number) => round(median(runs.map(pick)));
  return {
    scenario: "open",
    conversation: flags.conversation,
    reload: flags.reload,
    medianFirstRowMs: med((r) => r.firstRowMs),
    medianSplitToFirstRowMs: {
      mainThreadTask: med((r) => r.split.mainThreadTaskMs!),
      scripting: med((r) => r.split.scriptingMs!),
      layout: med((r) => r.split.layoutMs!),
      style: med((r) => r.split.styleMs!),
      otherMainThread: med((r) => r.split.otherMainThreadMs!),
    },
    medianLongTasksBeforeFirstRow: med((r) => r.longTasksBeforeFirstRow.count),
    medianLongTaskTotalBeforeFirstRowMs: med(
      (r) => r.longTasksBeforeFirstRow.totalMs,
    ),
    medianMaxLongTaskMs: med((r) => r.settledLongTasks.maxMs),
    medianNetwork: {
      requests: med((r) => r.network.requests),
      responseBytes: med((r) => r.network.responseBytes),
      webSocketFramesReceived: med((r) => r.network.webSocketFramesReceived),
      webSocketBytesReceived: med((r) => r.network.webSocketBytesReceived),
      webSocketFirstFrameMs: med((r) => r.network.webSocketFirstFrameMs),
      webSocketLastFrameMs: med((r) => r.network.webSocketLastFrameMs),
      totalDurationMs: med((r) => r.network.totalDurationMs),
    },
    runs,
  };
}
