/**
 * Repeatable transcript performance benchmark for a running desktop dev
 * instance (`pnpm run desktop:dev --slot N`, Chrome DevTools Protocol on :9222).
 * It attaches over raw CDP (`ws`), drives the real UI with trusted mouse and
 * keyboard events and never touches app code.
 *
 *   open    Open a large conversation from a different one and measure click →
 *           first transcript row, with the time split into network, scripting,
 *           layout/style and the rest (CDP Performance metrics + longtask +
 *           Network events). Median over --runs.
 *   heap    Retained JS heap after GC across repeated opens (--snapshots saves
 *           .heapsnapshot files).
 *   stream  Send a fixed tool-heavy prompt in a new conversation and measure
 *           long tasks (>50 ms) and rAF frame gaps while it runs, plus an
 *           optional V8 CPU profile (--profile) summarised by self time.
 *
 * Usage:
 *   pnpm exec tsx scripts/development/transcript-bench.ts --scenario open \
 *     --conversation conv_… --search "title words" [--runs 5] [--reload]
 *   pnpm exec tsx scripts/development/transcript-bench.ts --scenario stream \
 *     --project Random [--profile] [--out /tmp/nerve-bench]
 *
 * Deterministic, token-free stream runs: start the dev instance with
 * `NERVE_DEV_SCRIPTED_PROVIDER=1 pnpm desktop:dev --slot N` and pass `--scripted`
 * (same as `--model "Scripted Bench"`).
 *
 * Raw output (results.json, CPU profiles, traces) goes to --out, never the repo.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../cli/args.ts";
import { CliError, defineCli } from "../cli/main.ts";
import { Cdp } from "./transcript-bench/cdp.ts";
import type { Flags } from "./transcript-bench/flags.ts";
import { heapScenario } from "./transcript-bench/heap.ts";
import { openScenario } from "./transcript-bench/open.ts";
import { streamScenario } from "./transcript-bench/stream.ts";

async function main(argv: string[]): Promise<void> {
  const values = parseCli(
    "transcript-bench.ts",
    {
      scenario: {
        type: "string",
        description: "`open` or `stream` (required).",
      },
      cdp: {
        type: "string",
        description: "CDP endpoint.",
        default: "http://127.0.0.1:9222",
      },
      runs: { type: "string", description: "Repetitions.", default: "5" },
      out: {
        type: "string",
        description: "Raw output directory (outside the repo).",
        default: "/tmp/nerve-bench",
      },
      conversation: {
        type: "string",
        description: "open: conversation id to open.",
        default: "conv_01M4CZZC4ZNWD98Y824N607GZJ",
      },
      search: {
        type: "string",
        description: "open: search text that lists the conversation.",
        default: "Every sub-agent, lead agent",
      },
      project: {
        type: "string",
        description: "Project button label.",
        default: "nerve",
      },
      reload: {
        type: "boolean",
        description:
          "open: reload the page before each run (cold client caches).",
      },
      profile: {
        type: "boolean",
        description: "stream: record a V8 CPU profile.",
      },
      trace: {
        type: "boolean",
        description:
          "stream: record a Chrome trace (stream-N.trace.json) with frame and GC events.",
      },
      model: {
        type: "string",
        description: "stream: model to pick in the composer.",
        default: "Haiku 5.5",
      },
      scripted: {
        type: "boolean",
        description:
          'stream: use the dev-only scripted model ("Scripted Bench"); needs NERVE_DEV_SCRIPTED_PROVIDER=1 on the dev instance.',
      },
      "no-network": {
        type: "boolean",
        description:
          "Skip Network capture (CDP WebSocket frame copies add main-thread cost); the split is then unperturbed.",
      },
      prompt: {
        type: "string",
        description: "stream: prompt (default: fixed todo-app prompt).",
      },
      snapshots: {
        type: "boolean",
        description: "heap: also write .heapsnapshot files to --out.",
      },
      "timeout-sec": {
        type: "string",
        description: "stream: max run time.",
        default: "300",
      },
    },
    argv,
  );
  const scenario = values.scenario;
  if (scenario !== "open" && scenario !== "stream" && scenario !== "heap")
    throw new CliError("--scenario must be `open`, `stream` or `heap`.");
  const flags: Flags = {
    scenario,
    cdp: values.cdp as string,
    runs: Number(values.runs),
    out: values.out as string,
    conversation: values.conversation as string,
    search: values.search as string,
    project: values.project as string,
    reload: values.reload,
    profile: values.profile,
    trace: values.trace,
    model: values.scripted ? "Scripted Bench" : (values.model as string),
    noNetwork: values["no-network"],
    prompt: values.prompt,
    timeoutSec: Number(values["timeout-sec"]),
    snapshots: values.snapshots,
  };
  mkdirSync(flags.out, { recursive: true });
  const cdp = await Cdp.connect(flags.cdp);
  try {
    // A backgrounded window throttles rAF and input; keep the page active.
    await cdp.send("Page.bringToFront");
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.send("Runtime.enable");
    await cdp.send("Performance.enable");
    const result =
      scenario === "open"
        ? await openScenario(cdp, flags)
        : scenario === "heap"
          ? await heapScenario(cdp, flags)
          : await streamScenario(cdp, flags);
    const file = join(flags.out, `${scenario}-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({ ...(result as object), runs: undefined }, null, 2),
    );
    console.log(`raw results: ${file}`);
  } finally {
    cdp.close();
  }
}

defineCli(import.meta.url, main);
