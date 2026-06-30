import { spawn } from "node:child_process";
import { createRequire } from "node:module";
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

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const forwardedArgs = process.argv.slice(2);
const ozonePlatform = parseElectronOzonePlatform(
  process.env.NERVE_ELECTRON_OZONE_PLATFORM,
);
const linuxSwitches = [
  "--class=nerve",
  ...(ozonePlatform ? [`--ozone-platform=${ozonePlatform}`] : []),
];
const electronArgs =
  process.platform === "linux"
    ? [...linuxSwitches, ".", ...forwardedArgs]
    : [".", ...forwardedArgs];

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
