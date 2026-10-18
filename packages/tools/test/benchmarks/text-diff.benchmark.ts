// Synthetic only. From packages/tools:
// pnpm exec tsx test/benchmarks/text-diff.benchmark.ts
// Each workload runs in a bounded child; no filesystem mutations or Nerve data.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import * as errors from "../../src/execution/errors/tool-error.js";
import * as editErrors from "../../src/execution/filesystem/edit-errors.js";
import * as text from "../../src/execution/filesystem/text-editing.js";
import type { executeEdit } from "../../src/execution/filesystem/edit.js";

const trials = 9;
const inputLimit = 2 * 1024 * 1024;
const outputLimit = 4 * 1024 * 1024;
const burstSize = 4;
const names = [
  "small",
  "small-crlf-bom",
  "repeated-lines",
  "many-replacements",
  "low-similarity-200",
  "low-similarity-800",
  "low-similarity-1600",
] as const;
type Edit = { oldText: string; newText: string };

function fixture(name: string) {
  let before: string;
  let edits: Edit[];
  if (name === "small" || name === "small-crlf-bom") {
    before = Array.from(
      { length: 80 },
      (_, i) => `const value_${i} = ${i};\n`,
    ).join("");
    edits = [
      { oldText: "const value_40 = 40;", newText: "const value_40 = 41;" },
    ];
  } else if (name === "repeated-lines") {
    before = `${"repeated synthetic line abcdefghijklmnopqrstuvwxyz\n".repeat(5000)}unique middle marker\n${"repeated synthetic line abcdefghijklmnopqrstuvwxyz\n".repeat(5000)}`;
    edits = [
      { oldText: "unique middle marker", newText: "changed middle marker" },
    ];
  } else if (name === "many-replacements") {
    before = Array.from(
      { length: 3000 },
      (_, i) =>
        `synthetic row ${i.toString().padStart(5, "0")} payload abcdefghijklmnopqrstuvwxyz\n`,
    ).join("");
    edits = Array.from({ length: 300 }, (_, i) => ({
      oldText: `synthetic row ${(i * 10).toString().padStart(5, "0")} payload`,
      newText: `modified row ${(i * 10).toString().padStart(5, "0")} payload`,
    }));
  } else {
    assert.ok(name.startsWith("low-similarity-"));
    const lines = Number(name.split("-").at(-1));
    assert.ok([200, 800, 1600].includes(lines));
    before = Array.from(
      { length: lines },
      (_, i) => `before_${i} synthetic old payload\n`,
    ).join("");
    edits = [
      {
        oldText: before,
        newText: Array.from(
          { length: lines },
          (_, i) => `after_${i} unrelated new value\n`,
        ).join(""),
      },
    ];
  }
  // Fixtures use disjoint unique matches. This computes only the expected oracle;
  // measured transformation uses executeEdit's actual unmodified source below.
  let after = before;
  for (const edit of edits) {
    assert.equal(before.split(edit.oldText).length, 2);
    after = after.replace(edit.oldText, edit.newText);
  }
  const raw =
    name === "small-crlf-bom"
      ? `\uFEFF${before.replace(/\n/g, "\r\n")}`
      : before;
  const expectedRaw =
    name === "small-crlf-bom" ? `\uFEFF${after.replace(/\n/g, "\r\n")}` : after;
  assert.ok(
    Buffer.byteLength(raw) + Buffer.byteLength(expectedRaw) <= inputLimit,
  );
  return { before, after, raw, expectedRaw, edits };
}

// Evaluate the ACTUAL edit.ts body, not a copied transformation. Only I/O,
// path resolution and lane admission are replaced with explicit in-memory ports.
// No permission/approval/executor path is exercised or modified by this harness.
async function memoryPipeline(raw: string) {
  const { SourceTextModule, SyntheticModule } = await import("node:vm");
  const state = { raw, writes: 0, failDiff: false };
  const url = new URL(
    "../../src/execution/filesystem/edit.ts",
    import.meta.url,
  );
  const source = await readFile(url, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: fileURLToPath(url),
  }).outputText;
  const ports: Record<string, Record<string, unknown>> = {
    "node:fs/promises": { readFile: async () => state.raw },
    "./atomic-write.js": {
      writeTextFileAtomically: async (_path: string, value: string) => {
        state.raw = value;
        state.writes += 1;
      },
    },
    "./file-mutation-queue.js": {
      withFileMutationQueue: async (
        _path: string,
        run: () => Promise<unknown>,
      ) => run(),
    },
    "./path.js": { resolveToolPath: () => "/synthetic/text-diff.txt" },
    "../errors/tool-error.js": { ...errors },
    "./edit-errors.js": { ...editErrors },
    "./text-editing.js": {
      ...text,
      generateDiffString: (before: string, after: string) => {
        if (state.failDiff) throw new Error("synthetic diff failure");
        return text.generateDiffString(before, after);
      },
    },
  };
  const module = new SourceTextModule(js, { identifier: url.href });
  await module.link(async (specifier) => {
    const values = ports[specifier];
    assert.ok(
      values,
      `Unexpected source dependency: ${specifier}; review harness`,
    );
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values))
        this.setExport(key, value);
    });
  });
  await module.evaluate();
  const execute = (module.namespace as { executeEdit: typeof executeEdit })
    .executeEdit;
  return {
    state,
    run: (edits: Edit[]) =>
      execute({ path: "/synthetic/text-diff.txt", edits }, {
        cwd: "/synthetic",
      } as Parameters<typeof execute>[1]),
  };
}

const quantile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const round = (value: number) => Number(value.toFixed(3));

async function child(name: string, mode: string) {
  const f = fixture(name);
  const harness = await memoryPipeline(f.raw);
  const expectedDiff = text.generateDiffString(f.before, f.after);
  assert.ok(Buffer.byteLength(expectedDiff) <= outputLimit);
  const run = async () => {
    if (mode === "kernel") return text.generateDiffString(f.before, f.after);
    harness.state.raw = f.raw;
    const result = await harness.run(f.edits);
    assert.equal(harness.state.raw, f.expectedRaw);
    assert.equal(result.details?.operationCount, f.edits.length);
    return result.details?.diff;
  };
  assert.equal(await run(), expectedDiff);
  const samples: { wall: number; cpu: number; lag: number; rss: number }[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    await sleep(3);
    const cpu = process.cpuUsage();
    const start = performance.now();
    // Timer is armed BEFORE synchronous work; await it after the call/burst.
    // This measures request-attributable stall, not an idle-diluted histogram.
    let lag = 0;
    const heartbeat = new Promise<void>((resolve) =>
      setTimeout(() => {
        lag = Math.max(0, performance.now() - start - 1);
        resolve();
      }, 1),
    );
    const count = mode === "burst" ? burstSize : 1;
    // Actual executeEdit calls resume in microtasks. No fake worker/offloading.
    const results = await Promise.all(
      Array.from({ length: count }, () => run()),
    );
    const wall = performance.now() - start;
    const used = process.cpuUsage(cpu);
    await heartbeat;
    for (const result of results) assert.equal(result, expectedDiff);
    samples.push({
      wall,
      cpu: (used.user + used.system) / 1000,
      lag,
      rss: process.memoryUsage().rss,
    });
  }
  // Inspect post-write failure semantics with the real catch/result mapper.
  harness.state.raw = f.raw;
  harness.state.failDiff = true;
  await assert.rejects(harness.run(f.edits), (error: unknown) => {
    assert.ok(error instanceof errors.ToolExecutionError);
    assert.equal(error.code, "EDIT_FAILED");
    assert.equal(error.details.appliedCount, 0);
    assert.equal(harness.state.raw, f.expectedRaw);
    return true;
  });
  harness.state.failDiff = false;
  harness.state.raw = f.raw;
  const writes = harness.state.writes;
  await assert.rejects(
    harness.run([{ oldText: "absent synthetic needle", newText: "x" }]),
    (error: unknown) =>
      error instanceof errors.ToolExecutionError &&
      error.code === "EDIT_MATCH_NOT_FOUND",
  );
  assert.equal(harness.state.writes, writes);
  console.log(
    JSON.stringify({
      name,
      mode,
      trials,
      callsPerTrial: mode === "burst" ? burstSize : 1,
      inputBytes: Buffer.byteLength(f.raw),
      outputBytes: Buffer.byteLength(f.expectedRaw),
      patchBytes: Buffer.byteLength(expectedDiff),
      replacements: f.edits.length,
      wallP50Ms: round(
        quantile(
          samples.map((s) => s.wall),
          0.5,
        ),
      ),
      wallP95Ms: round(
        quantile(
          samples.map((s) => s.wall),
          0.95,
        ),
      ),
      cpuP50Ms: round(
        quantile(
          samples.map((s) => s.cpu),
          0.5,
        ),
      ),
      timerLagP95Ms: round(
        quantile(
          samples.map((s) => s.lag),
          0.95,
        ),
      ),
      rssMaxMiB: round(Math.max(...samples.map((s) => s.rss)) / 1024 / 1024),
      maxRssMiB: round(process.resourceUsage().maxRSS / 1024),
      parity: "passed",
      failureSemantics:
        "post-write diff failure reports appliedCount=0; missing match does not write",
    }),
  );
}

if (process.argv[2] === "--child") {
  assert.ok(names.includes(process.argv[3] as (typeof names)[number]));
  assert.ok(["kernel", "pipeline", "burst"].includes(process.argv[4]));
  await child(process.argv[3], process.argv[4]);
} else {
  console.log(
    JSON.stringify({
      syntheticOnly: true,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: cpus()[0]?.model,
      trials,
      inputLimit,
      outputLimit,
      timeoutMs: 20_000,
      heapLimitMiB: 256,
      note: "fresh subprocess per case/mode; one warm-up; nine warm calls; p95=max; timer baseline 1ms; burst=4; VM/transpile/fixture setup excluded; RSS includes harness/TS compiler; no disk/network/permissions/queue timing",
    }),
  );
  for (const name of names) {
    for (const mode of ["kernel", "pipeline", "burst"]) {
      try {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            "--max-old-space-size=256",
            "--experimental-vm-modules",
            "--import",
            "tsx",
            fileURLToPath(import.meta.url),
            "--child",
            name,
            mode,
          ],
          { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 128 * 1024 },
        );
        process.stdout.write(stdout);
      } catch {
        console.log(
          JSON.stringify({
            name,
            mode,
            status:
              "bounded child failed or exceeded 20s/256MiB; no performance claim",
          }),
        );
        process.exitCode = 1;
        // Do not escalate to larger adversarial inputs after a failed safe bound.
        process.exit(1);
      }
    }
  }
}
