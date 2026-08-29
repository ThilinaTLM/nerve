import { app } from "../platform/electron/electron-api.js";
import {
  type ElectronFontRenderHinting,
  parseElectronFontRenderHinting,
  resolveElectronFontRenderHinting,
} from "../platform/chromium/font-rendering.js";
import {
  electronOzonePlatformSwitch,
  type ElectronOzonePlatform,
  parseElectronOzonePlatform,
} from "../platform/chromium/ozone-platform.js";
import type { DesktopCliOptions } from "../types.js";

export type { ElectronFontRenderHinting, ElectronOzonePlatform };
export {
  parseElectronFontRenderHinting,
  parseElectronOzonePlatform,
  resolveElectronFontRenderHinting,
};

export function parseDesktopOptions(args: string[]): DesktopCliOptions {
  const options: DesktopCliOptions = {};
  let sawLocal = false;
  let sawConnect = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === "." || arg === "--") continue;

    if (arg === "--local") {
      sawLocal = true;
      options.mode = "local";
      continue;
    }
    if (arg === "--allow-remote") {
      options.allowRemote = true;
      continue;
    }
    if (arg === "--mobile-https") {
      options.mobileHttps = true;
      continue;
    }
    if (arg === "--connect") {
      sawConnect = true;
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --connect.");
      options.remoteUrl = value;
      options.mode = "remote";
      index += 1;
      continue;
    }
    if (arg.startsWith("--connect=")) {
      sawConnect = true;
      options.remoteUrl = arg.slice("--connect=".length);
      options.mode = "remote";
      continue;
    }
    if (arg === "--token") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --token.");
      options.token = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length);
      continue;
    }
    if (arg === "--host") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --host.");
      options.host = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
      continue;
    }
    if (arg === "--port") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --port.");
      options.port = parsePort(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
      continue;
    }
    if (arg === "--https-port") {
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --https-port.");
      options.httpsPort = parsePort(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--https-port=")) {
      options.httpsPort = parsePort(arg.slice("--https-port=".length));
    }
  }

  if (sawLocal && sawConnect) {
    throw new Error("Use either --local or --connect, not both.");
  }
  return options;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

export function applyElectronOzonePlatform(
  platform: ElectronOzonePlatform | undefined,
): void {
  const platformSwitch = electronOzonePlatformSwitch(platform);
  if (process.platform !== "linux" || !platformSwitch) return;
  app.commandLine.appendSwitch("ozone-platform", platformSwitch);
}

export function applyElectronFontRenderHinting(
  hinting: ElectronFontRenderHinting | undefined,
): void {
  if (process.platform !== "linux" || !hinting || hinting === "system") return;
  app.commandLine.appendSwitch("font-render-hinting", hinting);
}
