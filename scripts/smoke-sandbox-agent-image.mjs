#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

const cli = selectContainerCli();
const image =
  process.env.NERVE_SANDBOX_AGENT_IMAGE ?? "nerve-sandbox-agent:dev";
const inspect = JSON.parse(capture(cli, ["image", "inspect", image]))[0];
assertEqual(inspect.Config.User, "sandbox:sandbox", "agent image user");
assertEqual(inspect.Config.WorkingDir, "/workspace", "agent image workdir");
assertEqual(
  inspect.Config.Entrypoint?.join(" "),
  "node /agent/dist/main.js",
  "agent entrypoint",
);
if (!inspect.Config.Healthcheck?.Test?.join(" ").includes("healthcheck"))
  throw new Error("agent image healthcheck is missing");
if (inspect.Config.Labels?.["org.nerve.sandbox.spec"] !== "v1")
  throw new Error("agent image sandbox spec label is missing");
if (
  /agent-runtime|agent-tools|sandbox-runtime|orchestrator/.test(
    JSON.stringify(inspect.Config.Labels),
  )
)
  throw new Error("agent image labels contain a retired package name");

const root = await mkdtemp(join(os.tmpdir(), "nerve-agent-image-smoke-"));
const state = join(root, "state");
const workspace = join(root, "workspace");
await mkdir(join(state, "config"), { recursive: true });
await mkdir(workspace);
await chmod(state, 0o777);
await chmod(workspace, 0o777);
await writeFile(join(state, "config", "digest.txt"), "sha256:smoke\n");
await writeFile(join(state, "status.json"), '{"status":"ready"}\n');
await writeFile(join(state, "lock"), "smoke\n");
try {
  const mounts = ["-v", `${state}:/state`, "-v", `${workspace}:/workspace`];
  const health = capture(cli, [
    "run",
    "--rm",
    "--read-only",
    "--tmpfs",
    "/tmp",
    ...mounts,
    image,
    "healthcheck",
  ]);
  if (
    !health.includes('"healthy":true') ||
    !health.includes('"component":"nerve-sandbox-agent"')
  )
    throw new Error(`agent image healthcheck failed: ${health}`);
  run(cli, [
    "run",
    "--rm",
    "--read-only",
    "--tmpfs",
    "/tmp",
    ...mounts,
    "--entrypoint",
    "node",
    image,
    "-e",
    "const fs=require('fs'); fs.writeFileSync('/state/write-test','ok'); fs.writeFileSync('/workspace/write-test','ok'); try { fs.writeFileSync('/agent/forbidden','x'); process.exit(2) } catch {} console.log(process.getuid()+':'+process.getgid())",
  ]);
  capture(cli, [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-c",
    `test -f /agent/dist/main.js && test ! -e /agent/.git && bad="$(find /agent -maxdepth 3 -name '*.tgz' -print -quit)" && test -z "$bad"`,
  ]);
  console.log(`Sandbox agent image smoke passed for ${image}.`);
} finally {
  await rm(root, { recursive: true, force: true });
}

function selectContainerCli() {
  const configured = process.env.NERVE_CONTAINER_CLI?.trim();
  if (configured) return configured;
  for (const candidate of ["docker", "podman"]) {
    if (spawnSync(candidate, ["version"], { stdio: "ignore" }).status === 0)
      return candidate;
  }
  throw new Error(
    "Neither Docker nor Podman is available for the sandbox agent image smoke.",
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
function assertEqual(actual, expected, label) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
