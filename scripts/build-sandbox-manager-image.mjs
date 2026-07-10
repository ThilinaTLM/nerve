#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const imageTag =
  process.env.NERVE_SANDBOX_MANAGER_IMAGE ?? "nerve-sandbox-manager:dev";
const installLocalRuntimes =
  process.env.NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES ?? "true";
const useShell = process.platform === "win32";

run("pnpm", [
  "--filter",
  "@nervekit/sandbox-manager...",
  "--filter",
  "@nervekit/sandbox-manager-app",
  "build",
]);
run("node", ["scripts/copy-sandbox-manager-app-dist-to-manager.mjs"]);

const cli = selectContainerCli();
console.log(`Building ${imageTag} with ${cli}`);
run(cli, [
  "build",
  "-f",
  "packages/sandbox-manager/Dockerfile",
  "--build-arg",
  `INSTALL_LOCAL_RUNTIMES=${installLocalRuntimes}`,
  "-t",
  imageTag,
  ".",
]);

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
    "Neither Docker nor Podman is available to build the sandbox manager image.",
  );
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
