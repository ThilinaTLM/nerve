#!/usr/bin/env node
/**
 * Nerve desktop cold-start profiler (agent-browser driven).
 *
 * Launches the Electron desktop app against an isolated NERVE_HOME + ports +
 * userData dir with remote debugging enabled, records a CDP trace from the
 * earliest page target, evaluates a performance-collection script once the
 * workbench startup sequence finishes, and pulls main-process/daemon phase
 * timings from the app's own JSONL logs. Writes one JSON result file per run.
 *
 * Usage:
 *   node scripts/perf/desktop-startup-profile.mjs \
 *     --home /tmp/nerve-perf/home --run <id> --out /tmp/nerve-perf/result.json \
 *     [--cdp 9223] [--port 4747] [--ud /tmp/nerve-perf/ud] [--display :99]
 *     [--trace] [--preserve-index] [--preserve-runs]
 *
 * Environment notes (learned the hard way):
 *   - ELECTRON_RUN_AS_NODE must NOT be set when spawning Electron, or the
 *     binary executes as plain Node ("bad option" errors). start-electron.mjs
 *     deletes it for the same reason.
 *   - Do NOT use `agent-browser vitals` on the connected Electron target: it
 *     issues a page reload, which pollutes startup measurements.
 *   - Without --preserve-index, state.sqlite is deleted before each run so the
 *     daemon exercises the full journal-rehydration path. With it, the
 *     persisted tool-call snapshot is preserved so the fast path is measured.
 *   - Without --preserve-runs, run-runtime/ is wiped so the run subsystem
 *     starts empty (warm-up of the run lookup index is not exercised).
 *   - Runs need a display; on headless hosts start Xvfb first (e.g. Xvfb :99).
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const DESKTOP_SHELL = join(repoRoot, "packages", "desktop-shell");
const require = createRequire(join(DESKTOP_SHELL, "package.json"));
const ELECTRON_BIN = require("electron");
const AGENT_BROWSER = process.env.AGENT_BROWSER_BIN ?? "agent-browser";

function parseArgs(argv) {
  const args = {
    cdp: 9223,
    port: 4747,
    ud: "/tmp/nerve-perf/ud",
    display: ":99",
    trace: false,
    preserveIndex: false,
    preserveRuns: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--home") args.home = argv[++i];
    else if (a === "--run") args.run = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--cdp") args.cdp = Number(argv[++i]);
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--ud") args.ud = argv[++i];
    else if (a === "--display") args.display = argv[++i];
    else if (a === "--trace") args.trace = true;
    else if (a === "--preserve-index") args.preserveIndex = true;
    else if (a === "--preserve-runs") args.preserveRuns = true;
  }
  if (!args.home || !args.run || !args.out) {
    throw new Error("--home, --run, --out are required");
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, { timeoutMs, intervalMs = 250, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch {
      // keep polling
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label ?? "condition"}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

function runAgentBrowser(cdpPort, args, input) {
  return new Promise((resolve) => {
    const child = spawn(AGENT_BROWSER, ["--cdp", String(cdpPort), ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (error) =>
      resolve({ code: 1, stdout, stderr: String(error) }),
    );
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function latestLogFile(home, prefix) {
  const logsDir = join(home, "logs");
  if (!existsSync(logsDir)) return undefined;
  const files = (await readdir(logsDir)).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".jsonl"),
  );
  if (files.length === 0) return undefined;
  files.sort();
  return join(logsDir, files[files.length - 1]);
}

async function readLogRecords(path) {
  if (!path || !existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const records = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

// Performance snapshot evaluated in the renderer once the workbench is up.
const COLLECT_EXPRESSION = `(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const resources = performance.getEntriesByType("resource").map((e) => ({
    name: e.name,
    initiatorType: e.initiatorType,
    startTime: Math.round(e.startTime),
    duration: Math.round(e.duration),
    transferSize: e.transferSize,
    decodedBodySize: e.decodedBodySize,
    encodedBodySize: e.encodedBodySize,
  }));
  return JSON.stringify({
    nav: nav
      ? {
          domContentLoadedEventEnd: Math.round(nav.domContentLoadedEventEnd),
          domInteractive: Math.round(nav.domInteractive),
          loadEventEnd: Math.round(nav.loadEventEnd),
          responseEnd: Math.round(nav.responseEnd),
          transferSize: nav.transferSize,
          decodedBodySize: nav.decodedBodySize,
          duration: Math.round(nav.duration),
        }
      : null,
    paints: performance
      .getEntriesByType("paint")
      .map((e) => ({ name: e.name, startTime: Math.round(e.startTime) })),
    timeOrigin: performance.timeOrigin,
    now: Math.round(performance.now()),
    readyState: document.readyState,
    resourceCount: resources.length,
    resources,
    title: document.title,
    url: location.href,
  });
})()`;

function main() {
  const args = parseArgs(process.argv);
  run(args).catch((error) => {
    console.error(`harness error: ${error.stack ?? error}`);
    process.exitCode = 1;
  });
}

async function run(args) {
  const {
    home,
    run: runId,
    out,
    cdp,
    port,
    ud,
    display,
    trace,
    preserveIndex,
    preserveRuns,
  } = args;
  const startedEpoch = Date.now();
  const state = {
    ok: false,
    run: runId,
    home,
    spawnEpoch: null,
    error: null,
    main: {},
    daemon: {},
    renderer: {},
    warnings: [],
  };

  // Fresh slate: drop the daemon file, per-run logs, and temp run data so each
  // run starts from the same cold condition. Persistent data files under logs/
  // (tool-calls.jsonl, events.jsonl) and, with --preserve-index, state.sqlite
  // are kept.
  await rm(join(home, "daemon.json"), { force: true });
  await rm(join(home, "tmp"), { recursive: true, force: true });
  if (!preserveRuns) {
    await rm(join(home, "run-runtime"), { recursive: true, force: true });
  }
  if (!preserveIndex) {
    await rm(join(home, "state.sqlite"), { force: true });
    await rm(join(home, "state.sqlite-wal"), { force: true });
    await rm(join(home, "state.sqlite-shm"), { force: true });
  }
  if (existsSync(join(home, "logs"))) {
    for (const name of await readdir(join(home, "logs"))) {
      if (name.startsWith("application-") || name.startsWith("desktop-")) {
        await rm(join(home, "logs", name), { force: true });
      }
    }
  }
  await mkdir(dirname(out), { recursive: true });

  // Fail fast if the daemon/CDP ports are already occupied by a stray process.
  for (const p of [cdp, port, port + 1]) {
    try {
      const response = await fetch(`http://127.0.0.1:${p}/`, {
        signal: AbortSignal.timeout(400),
      });
      throw new Error(`port ${p} already in use (${response.status})`);
    } catch (error) {
      if (error.message?.startsWith("port")) throw error;
      // Connection refused means the port is free enough.
    }
  }

  const electronArgs = [
    "--class=io.github.thilinatlm.nerve-v2",
    "--ozone-platform=x11",
    "--remote-debugging-port=" + cdp,
    "--user-data-dir=" + ud,
    ".",
  ];
  const env = {
    ...process.env,
    NERVE_HOME: home,
    NERVE_PORT: String(port),
    NERVE_HTTPS_PORT: String(port + 1),
    NERVE_LOGGING_ENABLED: "1",
    NERVE_ELECTRON_OZONE_PLATFORM: "x11",
    DISPLAY: display,
    WAYLAND_DISPLAY: "",
  };
  // Critical: without this the electron binary executes as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(ELECTRON_BIN, electronArgs, {
    cwd: DESKTOP_SHELL,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.spawnEpoch = Date.now();
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (c) => stdoutChunks.push(c));
  child.stderr.on("data", (c) => stderrChunks.push(c));
  child.on("error", (error) => {
    state.error = `spawn error: ${error.message}`;
  });
  const exited = new Promise((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal })),
  );

  try {
    await waitFor(() => fetchJson(`http://127.0.0.1:${cdp}/json/version`), {
      timeoutMs: 30_000,
      label: "CDP endpoint",
    });

    await waitFor(
      async () => {
        const targets = await fetchJson(`http://127.0.0.1:${cdp}/json/list`);
        return targets.some((t) => t.type === "page");
      },
      { timeoutMs: 60_000, label: "page target" },
    );

    if (trace) {
      const started = await runAgentBrowser(cdp, ["trace", "start"]);
      if (started.code !== 0) {
        state.warnings.push(`trace start: ${started.stderr.slice(0, 300)}`);
      }
    }

    await waitFor(
      async () => {
        const targets = await fetchJson(`http://127.0.0.1:${cdp}/json/list`);
        return targets.find(
          (t) =>
            t.type === "page" && t.url.startsWith(`http://127.0.0.1:${port}/`),
        );
      },
      { timeoutMs: 120_000, intervalMs: 300, label: "daemon page" },
    );

    const appLogPath = await waitFor(
      () => latestLogFile(home, "application-"),
      { timeoutMs: 30_000, label: "application log file" },
    );
    await waitFor(
      async () => {
        const records = await readLogRecords(appLogPath);
        return records.find((r) => r.message === "Workbench initialized");
      },
      { timeoutMs: 120_000, intervalMs: 400, label: "workbench initialized" },
    );

    await sleep(1500);

    const collect = await runAgentBrowser(
      cdp,
      ["eval", "--stdin", "--json"],
      COLLECT_EXPRESSION,
    );
    const parsed = tryParseLastJson(collect.stdout);
    if (collect.code === 0 && parsed) state.renderer = parsed;
    else state.warnings.push(`eval failed: ${collect.stderr.slice(0, 300)}`);

    if (trace) {
      const tracePath = join(dirname(out), `run-${runId}.trace.json`);
      await runAgentBrowser(cdp, ["trace", "stop", tracePath]);
      state.tracePath = tracePath;
    }

    const appRecords = await readLogRecords(appLogPath);
    state.daemon.logRecords = appRecords.map(pickDaemonRecord).filter(Boolean);
    state.daemon.workbenchInitialized = appRecords.find(
      (r) => r.message === "Workbench initialized",
    );

    const desktopLogPath = await latestLogFile(home, "desktop-");
    const desktopRecords = await readLogRecords(desktopLogPath);
    state.main.records = desktopRecords.map(pickDesktopRecord).filter(Boolean);
    state.main.startupReady = desktopRecords.find(
      (r) => r.message === "Desktop startup ready",
    );

    state.ok = Boolean(
      state.main.startupReady && state.daemon.workbenchInitialized,
    );
  } catch (error) {
    state.error = error.message;
    console.error(`run ${runId} failed: ${error.message}`);
  } finally {
    try {
      child.kill("SIGTERM");
      const result = await Promise.race([
        exited,
        sleep(20_000).then(() => ({ timeout: true })),
      ]);
      state.exit = result;
      if (result.timeout) {
        child.kill("SIGKILL");
        await Promise.race([exited, sleep(5000)]);
      }
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    await sleep(1500);
    state.elapsedMs = Date.now() - startedEpoch;
    state.childExited = child.exitCode !== null || child.signalCode !== null;

    await writeFile(
      out,
      JSON.stringify(
        {
          ...state,
          stdoutTail: Buffer.concat(stdoutChunks).toString("utf8").slice(-3000),
          stderrTail: Buffer.concat(stderrChunks).toString("utf8").slice(-3000),
        },
        null,
        2,
      ),
    );
    console.log(
      `run ${runId} done ok=${state.ok} elapsed=${state.elapsedMs}ms` +
        (state.error ? ` error=${state.error}` : ""),
    );
  }
}

function tryParseLastJson(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = unwrapJson(JSON.parse(lines[i]));
      if (parsed !== undefined && typeof parsed === "object") return parsed;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

function unwrapJson(value, depth = 0) {
  if (depth > 6) return undefined;
  if (typeof value === "string") {
    try {
      return unwrapJson(JSON.parse(value), depth + 1);
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of ["value", "result", "data"]) {
      if (key in value && value[key] !== undefined) {
        const inner = unwrapJson(value[key], depth + 1);
        if (
          inner &&
          typeof inner === "object" &&
          !Array.isArray(inner) &&
          ("nav" in inner || "resources" in inner || "success" in inner)
        ) {
          return inner;
        }
      }
    }
    return value;
  }
  return value;
}

function pickDesktopRecord(r) {
  if (!r || typeof r !== "object" || r.source !== "desktop") return undefined;
  return {
    message: r.message,
    ts: r.ts,
    durationMs: r.durationMs,
    context: r.context,
  };
}

function pickDaemonRecord(r) {
  if (!r || typeof r !== "object") return undefined;
  const interesting = new Set([
    "Daemon listening",
    "Event streams hydrated",
    "Registry hydrated",
    "Index rebuilt",
    "Agent Browser skills initialized",
    "Daemon storage initialized",
    "Workbench initialized",
  ]);
  if (!interesting.has(r.message)) return undefined;
  return {
    source: r.source,
    component: r.component,
    message: r.message,
    ts: r.ts,
    durationMs: r.durationMs,
    context: r.context,
  };
}

main();
