/** Scenario C: retained JS heap after GC across repeated open/close of a large conversation. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "./cdp.ts";
import { click, sleep } from "./cdp.ts";
import type { Flags } from "./flags.ts";
import { runOpenOnce, setSearch } from "./open.ts";

const MB = 1024 * 1024;

/** A wedged renderer must fail the run, not hang it. */
function within<T>(promise: Promise<T>, what: string, ms = 30_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`CDP timeout: ${what}`)), ms),
    ),
  ]);
}

async function heapMb(cdp: Cdp): Promise<number> {
  for (let i = 0; i < 3; i++) {
    await within(cdp.send("HeapProfiler.collectGarbage"), "collectGarbage");
    await sleep(300);
  }
  const usage = await within(
    cdp.send<{ usedSize: number }>("Runtime.getHeapUsage"),
    "getHeapUsage",
  );
  return Math.round((usage.usedSize / MB) * 10) / 10;
}

/** Stream a heap snapshot to `file` (cheap enough to run at three points). */
async function snapshot(cdp: Cdp, file: string): Promise<void> {
  const chunks: string[] = [];
  const off = cdp.on<{ chunk: string }>(
    "HeapProfiler.addHeapSnapshotChunk",
    (p) => chunks.push(p.chunk),
  );
  await within(
    cdp.send("HeapProfiler.takeHeapSnapshot", {
      reportProgress: false,
      captureNumericValue: true,
    }),
    "takeHeapSnapshot",
    240_000,
  );
  off();
  writeFileSync(file, chunks.join(""));
}

export async function heapScenario(cdp: Cdp, flags: Flags): Promise<unknown> {
  await within(cdp.send("HeapProfiler.enable"), "HeapProfiler.enable");
  await cdp.send("Page.reload");
  await sleep(4000);
  const baseline = await heapMb(cdp);
  const afterOpen: number[] = [];
  const afterSwitch: number[] = [];
  for (let i = 0; i < flags.runs; i++) {
    // runOpenOnce ends with the large conversation open; the next run first
    // closes it and opens a small one, so measure after that switch.
    await runOpenOnce(cdp, {
      conversation: flags.conversation,
      search: flags.search,
      reload: false,
      project: flags.project,
      noNetwork: true,
    });
    const open = await heapMb(cdp);
    // Switch to a small conversation (the large one's tab stays open).
    const small = await cdp.evaluate<string | null>(`(() => {
      const rows = [...document.querySelectorAll("[data-panel-row-id]")];
      return rows.map((r) => r.getAttribute("data-panel-row-id")).find((id) => id?.startsWith("conv_") && id !== ${JSON.stringify(flags.conversation)}) ?? null;
    })()`);
    if (small) {
      await setSearch(cdp, "");
      await click(cdp, `[data-panel-row-id="${small}"]`);
      await sleep(1500);
    }
    const switched = await heapMb(cdp);
    afterOpen.push(open);
    afterSwitch.push(switched);
    console.log(
      `open ${i + 1}: heap after GC ${open} MB switched ${switched} MB (baseline ${baseline})`,
    );
  }
  // Snapshots are slow and can wedge the renderer: only once, at the end.
  if (flags.snapshots)
    await snapshot(cdp, join(flags.out, "heap-final.heapsnapshot"));
  return {
    scenario: "heap",
    baselineMb: baseline,
    afterOpenMb: afterOpen,
    afterSwitchMb: afterSwitch,
  };
}
