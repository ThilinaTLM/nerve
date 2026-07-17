import { ensureDaemonConnection } from "./daemon/connection-service.js";
import { createNodeDaemonPorts } from "./daemon/node-integration.js";
import type { EnsureDaemonOptions, ManagedDaemon } from "./daemon/types.js";

export type {
  DaemonMode,
  DaemonStatus,
  DaemonStatusInfo,
  DaemonStatusListener,
  EnsureDaemonOptions,
  ManagedDaemon,
} from "./daemon/types.js";

/**
 * Deliberate desktop-shell composition entry: creates the Node runtime ports
 * and delegates connection/supervision to the platform-neutral daemon service.
 */
export function ensureDaemon(
  options: EnsureDaemonOptions = {},
): Promise<ManagedDaemon> {
  return ensureDaemonConnection(options, createNodeDaemonPorts());
}
