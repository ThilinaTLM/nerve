import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { isBuiltin } from "node:module";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { externalRuntimeDependencies } from "./npm-manifests.ts";

/** Smoke checks that exercise an installed (bundled) `@nervekit/desktop` package. */

// esbuild prints static imports/re-exports at the start of a line (the `from`
// of a multi-line specifier list starts its closing `}` line). Matching only
// that shape, plus literal dynamic imports, ignores code embedded in strings.
const importSpecifier =
  /^(?:(?:import|export)\b[^"'\n;]*?\bfrom\s*|import\s*|\}\s*from\s*)["']([^"']+)["']|\bimport\(["']([^"']+)["']\)/gm;

/**
 * Import specifiers in a bundled ESM file that the install cannot satisfy:
 * relative targets missing on disk, or bare packages outside the declared
 * externals (node builtins, electron, sharp, @nervekit/native-*).
 */
export function findUnresolvableImports(
  source: string,
  fileExists: (relativeSpecifier: string) => boolean,
): string[] {
  const unresolved: string[] = [];
  for (const match of source.matchAll(importSpecifier)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (!fileExists(specifier)) unresolved.push(specifier);
    } else if (!isAllowedBareImport(specifier)) unresolved.push(specifier);
  }
  return unresolved;
}

export function isAllowedBareImport(specifier: string): boolean {
  if (specifier.startsWith("node:") || isBuiltin(specifier)) return true;
  if (specifier.startsWith("@nervekit/native-")) return true;
  return externalRuntimeDependencies.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

/** Syntax-checks every bundled JS file and verifies all its imports resolve. */
export async function checkBundleImports(desktopRoot: string) {
  const dist = join(desktopRoot, "dist");
  for (const name of (await readdir(dist)).filter((file) =>
    file.endsWith(".js"),
  )) {
    const file = join(dist, name);
    const check = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (check.status !== 0)
      throw new Error(`dist/${name} failed node --check: ${check.stderr}`);
    const unresolved = findUnresolvableImports(
      await readFile(file, "utf8"),
      (specifier) => existsSync(resolve(dist, specifier)),
    );
    if (unresolved.length)
      throw new Error(
        `dist/${name} has unresolvable imports: ${unresolved.join(", ")}.`,
      );
  }
}

/** Starts the bundled daemon headless, checks health + index.html, stops it by PID. */
export async function smokeBundledDaemon(desktopRoot: string, version: string) {
  const home = await mkdtemp(join(os.tmpdir(), "nerve-bundle-smoke-"));
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("NERVE_")) delete env[key];
  Object.assign(env, {
    NERVE_HOME: home,
    NERVE_PORT: String(port),
    NERVE_MOBILE_HTTPS: "0",
    NERVE_HTTPS_PORT: String(port + 1),
    NODE_ENV: "production",
  });
  let output = "";
  const child = spawn(
    process.execPath,
    [
      join(desktopRoot, "dist", "daemon.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  try {
    await waitFor(
      async () => {
        const response = await fetch(`${origin}/health`).catch(() => undefined);
        if (!response?.ok) return false;
        return (
          ((await response.json()) as { lifecycle?: string }).lifecycle ===
          "ready"
        );
      },
      30_000,
      () => `daemon /health never became ready (pid ${child.pid})\n${output}`,
      child,
    );
    const token = (
      await readFile(join(home, "secrets", "daemon-token"), "utf8")
    ).trim();
    const config = (await (
      await fetch(`${origin}/api/client-config`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { status?: { version?: string } };
    if (config.status?.version !== version)
      throw new Error(
        `bundled daemon reports version ${config.status?.version}, expected ${version}.`,
      );
    const page = await fetch(`${origin}/`);
    const html = await page.text();
    if (!page.ok || !/\bid=(["'])app\1/.test(html))
      throw new Error(
        `bundled daemon did not serve index.html (${page.status}).`,
      );
    const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
    if (!asset || !(await fetch(`${origin}${asset}`)).ok)
      throw new Error(`bundled daemon did not serve static asset ${asset}.`);
    console.log(
      `Bundled daemon (pid ${child.pid}) healthy on ${origin}; served index.html and ${asset}.`,
    );
  } finally {
    await stopChild(child);
    await rm(home, { recursive: true, force: true });
  }
}

/** Runs the worker/subprocess entrypoints that can execute without Electron. */
export async function smokeWorkerEntrypoints(desktopRoot: string) {
  const dist = join(desktopRoot, "dist");

  const markdown = await new Promise<{ ok: boolean; markdown?: string }>(
    (done, fail) => {
      const worker = new Worker(join(dist, "html-to-markdown.worker.js"), {
        workerData: {
          source: "<p>Hello <strong>bundle</strong></p>",
          mode: "html",
          maxOutputBytes: 1024,
        },
      });
      worker.once("message", (message) => {
        void worker.terminate();
        done(message);
      });
      worker.once("error", fail);
    },
  );
  if (!markdown.ok || markdown.markdown !== "Hello **bundle**")
    throw new Error(
      `html-to-markdown worker returned ${JSON.stringify(markdown)}.`,
    );

  // The git helper keeps its process group alive after writing one frame, so
  // read a frame for deliberately invalid input and stop the helper by PID.
  const helper = spawn(
    process.execPath,
    [join(dist, "git-isolated-reader-helper.js"), "not-json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    let stdout = "";
    helper.stdout!.on("data", (chunk) => (stdout += chunk));
    await waitFor(
      () => stdout.includes('"version":1'),
      15_000,
      () => `git helper produced no frame (pid ${helper.pid}): ${stdout}`,
      helper,
    );
    const frame = JSON.parse(stdout.trim().split("\n")[0]!);
    if (frame.version !== 1 || frame.ok !== false)
      throw new Error(`unexpected git helper frame ${stdout}`);
  } finally {
    await stopChild(helper);
  }
  console.log(
    "Worker entrypoints smoke passed (html-to-markdown, git-isolated-reader-helper; migrations worker ran during daemon start).",
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  describe: () => string,
  child?: ChildProcess,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child && child.exitCode !== null)
      throw new Error(
        `process exited early (${child.exitCode}): ${describe()}`,
      );
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${describe()}`);
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
}

function availablePort() {
  return new Promise<number>((done, fail) => {
    const server = net.createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? done(port) : fail(new Error("no port"))));
    });
  });
}
