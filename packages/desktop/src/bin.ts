#!/usr/bin/env node
// Node-only launcher used by `npx @nervekit/desktop`, `pnpx @nervekit/desktop`,
// and the globally installed `nerve-desktop` bin. It spawns Electron as a child
// process against this package directory; it must not import the Electron main
// module (that runs inside the spawned Electron process).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  formatElectronDownloadFailure,
  formatProxyPreparationForLog,
  prepareElectronDownloadEnv,
} from "./electron-download-env.js";
import { resolveElectronFontRenderHinting } from "./shared/font-rendering.js";
import { parseElectronOzonePlatform } from "./shared/ozone-platform.js";

const require = createRequire(import.meta.url);

interface PackageManifest {
  name: string;
  version: string;
}

const manifest = require("../package.json") as PackageManifest;

const forwardedArgs = process.argv.slice(2);

if (forwardedArgs.includes("--version") || forwardedArgs.includes("-v")) {
  process.stdout.write(`${manifest.name} ${manifest.version}\n`);
  process.exit(0);
}

if (forwardedArgs.includes("--help") || forwardedArgs.includes("-h")) {
  process.stdout.write(
    [
      `${manifest.name} ${manifest.version}`,
      "",
      "Usage:",
      "  npx @nervekit/desktop [-- <app args>]",
      "  pnpx @nervekit/desktop [-- <app args>]",
      "  nerve-desktop [<app args>]",
      "",
      "Common app args:",
      "  --local                 Run an owned local daemon (default)",
      "  --connect <url>         Connect to a remote daemon",
      "  --token <token>         Auth token for remote connections",
      "  --host <host>           Bind host for the owned daemon",
      "  --port <port>           HTTP port for the owned daemon",
      "  --https-port <port>     HTTPS port for the owned daemon",
      "  --allow-remote          Allow non-loopback connections",
      "  --mobile-https          Enable mobile HTTPS setup flow",
      "",
      "Environment:",
      "  NERVE_ELECTRON_OZONE_PLATFORM=x11|wayland|auto  (Linux only)",
      "  NERVE_ELECTRON_FONT_RENDER_HINTING=system|none|slight|medium|full  (Linux only; default: slight)",
      "  ELECTRON_GET_USE_PROXY=true with HTTPS_PROXY/HTTP_PROXY/NO_PROXY  (corporate proxy downloads)",
      "  NODE_USE_ENV_PROXY=1 and NODE_USE_SYSTEM_CA=1 are enabled automatically when needed",
      "  NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem  (explicit TLS interception CA bundle)",
      "  NERVE_DEBUG_PROXY=1  Print redacted proxy diagnostics during startup",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const proxyPreparation = prepareElectronDownloadEnv(process.env);
logProxyPreparation(proxyPreparation);

// The electron npm package resolves to the platform binary path when required
// from a plain Node process.
const electronPath = resolveElectronPath();

function logProxyPreparation(
  preparation: ReturnType<typeof prepareElectronDownloadEnv>,
): void {
  if (process.env.NERVE_DEBUG_PROXY !== "1") return;
  console.error(
    `[nerve] desktop proxy preparation ${JSON.stringify(formatProxyPreparationForLog(preparation, process.env))}`,
  );
}

function resolveElectronPath(): string {
  try {
    return require("electron") as string;
  } catch (error) {
    console.error(formatElectronDownloadFailure(error));
    process.exit(1);
  }
}

// dist/bin.js lives in <packageRoot>/dist, so ".." is the package root that
// contains the built Electron app entry (dist/main.js) referenced by `main`.
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const ozonePlatform = parseElectronOzonePlatform(
  process.env.NERVE_ELECTRON_OZONE_PLATFORM,
);
const fontRenderHinting = resolveElectronFontRenderHinting(
  process.env.NERVE_ELECTRON_FONT_RENDER_HINTING,
);
const linuxSwitches = [
  "--class=nerve",
  ...(ozonePlatform ? [`--ozone-platform=${ozonePlatform}`] : []),
  ...(fontRenderHinting && fontRenderHinting !== "system"
    ? [`--font-render-hinting=${fontRenderHinting}`]
    : []),
];
const electronArgs =
  process.platform === "linux"
    ? [...linuxSwitches, ".", ...forwardedArgs]
    : [".", ...forwardedArgs];

const child = spawn(electronPath, electronArgs, {
  cwd: packageRoot,
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
