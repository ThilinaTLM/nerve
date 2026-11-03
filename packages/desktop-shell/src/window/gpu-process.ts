export interface GpuProcessRestartDependencies {
  getAppMetrics: () => ReadonlyArray<{ pid: number; type: string }>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
}

/**
 * Kills Electron's GPU process so Chromium relaunches it and re-creates the
 * compositor surfaces. Recovers windows that stop repainting after a GPU
 * context loss Chromium does not detect itself (e.g. Linux suspend/resume).
 * Returns the killed pid, or undefined when no GPU process is running.
 */
export function restartGpuProcess(
  dependencies: GpuProcessRestartDependencies,
): number | undefined {
  const gpu = dependencies
    .getAppMetrics()
    .find((metric) => metric.type === "GPU");
  if (!gpu) return undefined;
  // SIGKILL: a wedged GPU process may not honor a graceful termination.
  dependencies.kill(gpu.pid, "SIGKILL");
  return gpu.pid;
}
