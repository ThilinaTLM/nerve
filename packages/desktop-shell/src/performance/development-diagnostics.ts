const PERFORMANCE_DIAGNOSTICS_ENV = "NERVE_PERFORMANCE_DIAGNOSTICS";
const PERFORMANCE_SESSION_ENV = "NERVE_PERFORMANCE_SESSION_ID";

/** Enable lightweight performance logs automatically for source desktop runs. */
export function applyDevelopmentPerformanceDiagnostics(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
  options: { now?: () => Date; pid?: number } = {},
): void {
  if (!isPackaged && env[PERFORMANCE_DIAGNOSTICS_ENV] === undefined)
    env[PERFORMANCE_DIAGNOSTICS_ENV] = "1";
  if (
    env[PERFORMANCE_DIAGNOSTICS_ENV] !== "1" ||
    env[PERFORMANCE_SESSION_ENV] !== undefined
  )
    return;
  env[PERFORMANCE_SESSION_ENV] = createPerformanceSessionId(
    options.now?.() ?? new Date(),
    options.pid ?? process.pid,
  );
}

export function createPerformanceSessionId(now: Date, pid: number): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  return `${timestamp}-desktop-${Math.max(0, Math.trunc(pid))}`;
}
