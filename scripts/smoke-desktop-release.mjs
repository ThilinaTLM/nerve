#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeDaemonPorts } from "../packages/desktop-shell/dist/daemon/node-integration.js";
import {
  localConnectUrl,
  normalizeRemoteDaemonUrl,
} from "../packages/desktop-shell/dist/daemon/urls.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bin = join(repoRoot, "packages", "desktop-shell", "dist", "bin.js");
const serverMain = createNodeDaemonPorts().resolveServerMain();
await access(serverMain);
if (
  !serverMain.endsWith(join("packages", "workbench-server", "dist", "main.js"))
)
  throw new Error(
    `desktop resolved unexpected workbench server entry: ${serverMain}`,
  );
if (localConnectUrl("http://0.0.0.0:3747/path") !== "http://127.0.0.1:3747")
  throw new Error("desktop wildcard health URL selection is incorrect");
if (
  normalizeRemoteDaemonUrl("https://example.test/path") !==
  "https://example.test"
)
  throw new Error("desktop remote health URL normalization is incorrect");
const version = run([bin, "--version"]);
const help = run([bin, "--help"]);
if (!version.includes("@nervekit/desktop-shell") || !help.includes("Usage:"))
  throw new Error("desktop CLI version/help smoke failed");
console.log("Desktop release smoke passed.");

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || `desktop command exited ${result.status}`);
  return result.stdout;
}
