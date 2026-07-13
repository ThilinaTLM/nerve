#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import net from "node:net";

const cli = selectContainerCli();
const image =
  process.env.NERVE_SANDBOX_MANAGER_IMAGE ?? "nerve-sandbox-manager:dev";
const inspect = JSON.parse(capture(cli, ["image", "inspect", image]))[0];
assertEqual(
  inspect.Config.User,
  "sandbox-manager:sandbox-manager",
  "manager image user",
);
assertEqual(inspect.Config.WorkingDir, "/manager", "manager image workdir");
assertEqual(
  inspect.Config.Entrypoint?.join(" "),
  "node /manager/dist/main.js",
  "manager entrypoint",
);
if (!inspect.Config.Healthcheck?.Test?.join(" ").includes("/health"))
  throw new Error("manager image healthcheck is missing");
if (!inspect.Config.ExposedPorts?.["7869/tcp"])
  throw new Error("manager image must expose 7869/tcp");
if (inspect.Config.Labels?.["org.nerve.sandbox.spec"] !== "v1")
  throw new Error("manager image sandbox spec label is missing");
if (
  /agent-runtime|agent-tools|sandbox-runtime|orchestrator/.test(
    JSON.stringify(inspect.Config.Labels),
  )
)
  throw new Error("manager image labels contain a retired package name");

const suffix = `${process.pid}-${Date.now()}`;
const network = `nerve-release-${suffix}`;
const database = `nerve-release-db-${suffix}`;
const manager = `nerve-release-manager-${suffix}`;
const port = await availablePort();
try {
  run(cli, ["network", "create", network]);
  run(cli, [
    "run",
    "--detach",
    "--name",
    database,
    "--network",
    network,
    "-e",
    "POSTGRES_PASSWORD=nerve",
    "-e",
    "POSTGRES_DB=nerve",
    "postgres:16-alpine",
  ]);
  const databaseReady = () =>
    spawnSync(
      cli,
      [
        "exec",
        database,
        "psql",
        "-U",
        "postgres",
        "-d",
        "nerve",
        "-c",
        "select 1",
      ],
      { stdio: "ignore" },
    ).status === 0;
  await waitUntil(databaseReady, 30_000, "manager image PostgreSQL init");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
  await waitUntil(databaseReady, 30_000, "manager image PostgreSQL final");
  run(cli, [
    "run",
    "--detach",
    "--name",
    manager,
    "--network",
    network,
    "-p",
    `127.0.0.1:${port}:7869`,
    "-e",
    `NERVE_SANDBOX_MANAGER_DATABASE_URL=postgresql://postgres:nerve@${database}:5432/nerve`,
    "-e",
    "NERVE_SANDBOX_MANAGER_MODE=development",
    "-e",
    "NERVE_SANDBOX_MANAGER_ALLOW_CLEARTEXT_SECRETS=true",
    "-e",
    "NERVE_SANDBOX_MANAGER_STORAGE_DIR=/tmp/manager-state",
    "-e",
    "NERVE_SANDBOX_MANAGER_RECONCILE_ON_STARTUP=false",
    image,
  ]);
  await waitUntil(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
      } catch {
        return false;
      }
    },
    30_000,
    "manager image health",
  );
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  if (!asset || !(await fetch(`http://127.0.0.1:${port}${asset}`)).ok)
    throw new Error("manager image did not serve bundled static UI assets");
  const paths = capture(cli, [
    "exec",
    manager,
    "sh",
    "-c",
    "test -f /manager/dist/main.js && test -f /manager/dist/web/index.html && test ! -e /manager/.git && find /manager/dist -name '*.test.js' -o -name '*.tgz'",
  ]).trim();
  if (paths)
    throw new Error(`manager image contains forbidden files:\n${paths}`);
  run(cli, ["stop", "--time", "10", manager]);
  console.log(`Sandbox manager image smoke passed for ${image}.`);
} finally {
  spawnSync(cli, ["rm", "-f", manager], { stdio: "ignore" });
  spawnSync(cli, ["rm", "-f", database], { stdio: "ignore" });
  spawnSync(cli, ["network", "rm", network], { stdio: "ignore" });
}

function selectContainerCli() {
  const configured = process.env.NERVE_CONTAINER_CLI?.trim();
  if (configured) return configured;
  for (const candidate of ["docker", "podman"]) {
    if (spawnSync(candidate, ["version"], { stdio: "ignore" }).status === 0)
      return candidate;
  }
  throw new Error(
    "Neither Docker nor Podman is available for the sandbox manager image smoke.",
  );
}
function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  return result.stdout;
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}`,
    );
}
async function waitUntil(predicate, timeoutMs, label) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
function assertEqual(actual, expected, label) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
