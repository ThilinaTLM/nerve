import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const home = await mkdtemp(join(tmpdir(), "nerve-browser-test-"));
const port = process.env.NERVE_BROWSER_TEST_PORT ?? "43747";
const child = spawn(
  process.execPath,
  [
    join(repoRoot, "packages/workbench-server/dist/main.js"),
    "--host",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      NERVE_HOME: home,
      NERVE_PORT: port,
      NERVE_MOBILE_HTTPS: "0",
      NERVE_HTTPS_PORT: String(Number(port) + 1),
      NERVE_ALLOW_UNCONTAINED_PROCESSES: "1",
      NERVE_LINUX_DELEGATED_CGROUP: "0",
      NERVE_CGROUP_ROOT: "",
      NODE_ENV: "production",
    },
    stdio: "inherit",
  },
);

let stopping = false;
async function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  await rm(home, { recursive: true, force: true });
  process.exit(0);
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
child.once("exit", async (code, signal) => {
  if (stopping) return;
  await rm(home, { recursive: true, force: true });
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
