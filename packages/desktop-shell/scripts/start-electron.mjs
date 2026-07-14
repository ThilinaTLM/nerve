import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatElectronDownloadFailure,
  formatProxyPreparationForLog,
  prepareElectronDownloadEnv,
} from "../dist/electron-download-env.js";

const require = createRequire(import.meta.url);

const cwd = fileURLToPath(new URL("..", import.meta.url));
const proxyPreparation = prepareElectronDownloadEnv(process.env);
logProxyPreparation(proxyPreparation);
const electronPath = resolveElectronPath();

const nerveHome =
  process.env.NERVE_HOME?.trim() || join(homedir(), ".nerve-v2");
const env = {
  ...process.env,
  NERVE_HOME: nerveHome,
  NERVE_PORT: process.env.NERVE_PORT?.trim() || "3757",
  NERVE_HTTPS_PORT: process.env.NERVE_HTTPS_PORT?.trim() || "3758",
};
delete env.ELECTRON_RUN_AS_NODE;

const forwardedArgs = process.argv.slice(2);
const ozonePlatform = parseElectronOzonePlatform(
  process.env.NERVE_ELECTRON_OZONE_PLATFORM,
);
const commonSwitches = [`--user-data-dir=${join(nerveHome, "desktop")}`];
const linuxSwitches = [
  "--class=io.github.thilinatlm.nerve-v2",
  ...(ozonePlatform ? [`--ozone-platform=${ozonePlatform}`] : []),
];
const electronArgs = [
  ...commonSwitches,
  ...(process.platform === "linux" ? linuxSwitches : []),
  ".",
  ...forwardedArgs,
];

function logProxyPreparation(preparation) {
  if (process.env.NERVE_DEBUG_PROXY !== "1") return;
  console.error(
    `[nerve] desktop proxy preparation ${JSON.stringify(formatProxyPreparationForLog(preparation, process.env))}`,
  );
}

function parseElectronOzonePlatform(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized === "x11" ||
    normalized === "wayland" ||
    normalized === "auto"
  ) {
    return normalized;
  }
  console.warn(
    `Ignoring invalid NERVE_ELECTRON_OZONE_PLATFORM=${JSON.stringify(value)}. Expected x11, wayland, or auto.`,
  );
  return undefined;
}

function resolveElectronPath() {
  try {
    return require("electron");
  } catch (error) {
    console.error(formatElectronDownloadFailure(error));
    process.exit(1);
  }
}

const child = spawn(electronPath, electronArgs, {
  cwd,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
