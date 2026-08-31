export interface RunRuntimeStartupResult<T> {
  value: T;
}

/** Current v1 storage failures are surfaced unchanged; startup never rewrites or backs up state. */
export async function startRunRuntime<T>(
  start: () => Promise<T>,
): Promise<RunRuntimeStartupResult<T>> {
  return { value: await start() };
}
