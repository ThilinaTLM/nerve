import { darwinProcessRuntimeDriver } from "./darwin-driver.js";
import { linuxProcessRuntimeDriver } from "./linux-driver.js";
import type { ProcessRuntimeDriver } from "./types.js";
import { windowsProcessRuntimeDriver } from "./windows-driver.js";

export function processRuntimeDriver(
  platform: NodeJS.Platform = process.platform,
): ProcessRuntimeDriver {
  if (platform === "linux") return linuxProcessRuntimeDriver;
  if (platform === "darwin") return darwinProcessRuntimeDriver;
  if (platform === "win32") return windowsProcessRuntimeDriver;
  throw new Error(`Unsupported process runtime platform: ${platform}`);
}

export const defaultProcessRuntimeDriver = processRuntimeDriver();
