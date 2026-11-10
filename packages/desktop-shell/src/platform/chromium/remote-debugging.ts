// Node-safe: must not import Electron.

export const REMOTE_DEBUGGING_PORT_ENV = "NERVE_ELECTRON_REMOTE_DEBUGGING_PORT";

/**
 * Reads the opt-in Chrome DevTools Protocol port and removes it from `env`.
 * The variable is consumed so that the daemon, and every terminal or agent
 * process it spawns, never inherits it. Otherwise a nested
 * `pnpm desktop:dev --slot N` would try to bind the same port.
 */
export function takeElectronRemoteDebuggingPort(
  env: NodeJS.ProcessEnv,
): number | undefined {
  const value = env[REMOTE_DEBUGGING_PORT_ENV];
  delete env[REMOTE_DEBUGGING_PORT_ENV];
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const port = Number(normalized);
  if (/^\d+$/.test(normalized) && port >= 1 && port <= 65_535) return port;
  console.warn(
    `Ignoring invalid ${REMOTE_DEBUGGING_PORT_ENV}=${JSON.stringify(value)}. Expected a port from 1 to 65535.`,
  );
  return undefined;
}
