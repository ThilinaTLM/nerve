import { ensureDaemonConnection } from "./connection.js";
import { createNodeDaemonPorts } from "./adapters/node-process.js";
import type { EnsureDaemonOptions, ManagedDaemon } from "./contracts.js";

export type {
  DaemonMode,
  DaemonStatus,
  DaemonStatusInfo,
  DaemonStatusListener,
  EnsureDaemonOptions,
  ManagedDaemon,
} from "./contracts.js";

/**
 * Deliberate desktop-shell composition entry: creates the Node runtime ports
 * and delegates connection/supervision to the platform-neutral daemon service.
 */
export function ensureDaemon(
  options: EnsureDaemonOptions = {},
): Promise<ManagedDaemon> {
  return ensureDaemonConnection(options, createNodeDaemonPorts());
}
