export const SHUTDOWN_ON_STDIN_CLOSE_ENV = "NERVE_SHUTDOWN_ON_STDIN_CLOSE";

interface ShutdownStdin {
  on(event: "end" | "close" | "error", listener: () => void): unknown;
  resume(): unknown;
}

/**
 * When the supervisor opted in, treat stdin end/close as a shutdown request.
 * Returns whether the watcher was installed. Daemons started from a terminal
 * or CLI never set the flag and are unaffected.
 */
export function watchStdinForShutdown(
  env: NodeJS.ProcessEnv,
  stdin: ShutdownStdin,
  onShutdown: () => void,
): boolean {
  const enabled = env[SHUTDOWN_ON_STDIN_CLOSE_ENV] === "1";
  // Never leak the flag to spawned processes: a nested daemon (e.g. `pnpm dev`
  // run from a tool) usually has empty stdin and would stop immediately.
  delete env[SHUTDOWN_ON_STDIN_CLOSE_ENV];
  if (!enabled) return false;
  stdin.on("end", onShutdown);
  stdin.on("close", onShutdown);
  stdin.on("error", onShutdown);
  stdin.resume(); // drain so 'end' fires
  return true;
}
