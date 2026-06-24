import { app } from "../electron.js";
import {
  type ElectronOzonePlatform,
  parseElectronOzonePlatform,
} from "../shared/ozone-platform.js";
import type { DesktopCliOptions } from "../types.js";

export type { ElectronOzonePlatform };
export { parseElectronOzonePlatform };

export function parseDesktopOptions(args: string[]): DesktopCliOptions {
  const options: DesktopCliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === "." || arg === "--") continue;

    if (arg === "--local") {
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
      const value = args[index + 1];
      if (!value) throw new Error("Missing value for --connect.");
      options.remoteUrl = value;
      options.mode = "remote";
      index += 1;
      continue;
    }
    if (arg.startsWith("--connect=")) {
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

  if (options.mode === "local" && options.remoteUrl) {
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
  if (process.platform !== "linux" || !platform) return;
  app.commandLine.appendSwitch("ozone-platform", platform);
}
