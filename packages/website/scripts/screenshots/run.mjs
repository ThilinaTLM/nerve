/**
 * One-command screenshot refresh: seed -> build -> daemon -> capture -> check
 * -> optimize.
 *
 * Everything runs against a throwaway home and workspace under the system temp
 * directory on a non-default port, so a refresh can never touch the real
 * ~/.nerve or the default 3747 daemon.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "3847" },
    scenes: { type: "string" },
    theme: { type: "string", default: "both" },
    github: { type: "boolean", default: false },
    "skip-seed": { type: "boolean", default: false },
    "skip-build": { type: "boolean", default: false },
  },
});

const repoRoot = resolve(import.meta.dirname, "../../../..");
const home = join(tmpdir(), "nerve-demo-home");
const workspace = join(tmpdir(), "nerve-demo-workspace");
const baseUrl = `http://127.0.0.1:${values.port}`;

function run(command, args, options = {}) {
  return new Promise((fulfil, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: repoRoot,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? fulfil(undefined)
        : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
    );
  });
}

async function waitForHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      /* daemon not listening yet */
    }
    await new Promise((fulfil) => setTimeout(fulfil, 500));
  }
  throw new Error(`Daemon did not become healthy at ${baseUrl}/health`);
}

if (!values["skip-seed"]) {
  await run(
    "pnpm",
    [
      "--filter",
      "@nervekit/workbench-server",
      "exec",
      "tsx",
      "scripts/seed-demo-home.ts",
    ],
    {
      env: {
        ...process.env,
        NERVE_HOME: home,
        NERVE_DEMO_WORKSPACE: workspace,
        NERVE_DEMO_GITHUB: values.github ? "1" : "0",
      },
    },
  );
}

if (!values["skip-build"]) {
  await run("pnpm", ["build:workbench-runtime"]);
}

const daemon = spawn("node", ["packages/workbench-server/dist/main.js"], {
  cwd: repoRoot,
  stdio: "ignore",
  env: {
    ...process.env,
    NERVE_HOME: home,
    NERVE_HOST: "127.0.0.1",
    NERVE_PORT: values.port,
    /* The capture daemon is a short-lived local fixture, not the desktop
     * daemon's delegated systemd scope. Do not inherit desktop containment
     * variables from the shell that launched the refresh. */
    NERVE_LINUX_DELEGATED_CGROUP: "0",
    NERVE_CGROUP_ROOT: "",
    NERVE_ALLOW_UNCONTAINED_PROCESSES: "1",
  },
});

try {
  await waitForHealth();
  const captureArgs = [
    "scripts/screenshots/capture.mjs",
    `--base-url=${baseUrl}`,
    `--theme=${values.theme}`,
  ];
  if (values.scenes) captureArgs.push(`--scenes=${values.scenes}`);
  if (values.github) captureArgs.push("--github");
  const website = join(repoRoot, "packages/website");
  await run("node", captureArgs, { cwd: website });
  await run("node", ["scripts/screenshots/check-captures.mjs"], {
    cwd: website,
  });
  await run("node", ["scripts/screenshots/optimize.mjs"], { cwd: website });
} finally {
  daemon.kill("SIGTERM");
}

console.log(
  "Screenshot refresh complete. Review every frame before committing.",
);
