#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const imageTag =
  process.env.NERVE_SANDBOX_AGENT_IMAGE ?? "nerve-sandbox-agent:dev";
const useShell = process.platform === "win32";

run("pnpm", ["--filter", "@nervekit/sandbox-agent...", "build"]);

const cli = selectContainerCli();
console.log(`Building ${imageTag} with ${cli}`);
run(cli, [
  "build",
  // Podman defaults to OCI, which cannot store Dockerfile HEALTHCHECK metadata.
  ...(isPodman(cli) ? ["--format", "docker"] : []),
  "-f",
  "packages/sandbox-agent/Dockerfile",
  "--build-arg",
  `NERVE_VERSION=${version}`,
  "-t",
  imageTag,
  ".",
]);
run("node", ["scripts/smoke-sandbox-agent-image.mjs"]);

function selectContainerCli() {
  const configured = process.env.NERVE_CONTAINER_CLI?.trim();
  if (configured) {
    if (isAvailable(configured)) return configured;
    fail(
      `Configured NERVE_CONTAINER_CLI is not available or not reachable: ${configured}`,
    );
  }
  if (isAvailable("docker")) return "docker";
  if (isAvailable("podman")) return "podman";
  fail(
    "Neither Docker nor Podman is available to build the sandbox agent image.",
  );
}

function isPodman(command) {
  return /(^|[\\/])podman(?:\.exe)?$/i.test(command);
}

function isAvailable(command) {
  const result = spawnSync(command, ["version"], {
    stdio: "ignore",
    shell: useShell,
  });
  return result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: useShell,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
