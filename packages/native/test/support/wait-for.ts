/** Polls `probe` until it returns a truthy value; fails with `message` and the last probe error. */
export async function waitFor<T>(
  probe: () => T | undefined | false | Promise<T | undefined | false>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<T> {
  const { timeoutMs = 5_000, intervalMs = 10, message = "condition" } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${message}`,
    lastError === undefined ? undefined : { cause: lastError },
  );
}
