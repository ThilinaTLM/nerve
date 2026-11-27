function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    })
  );
}

/** Resolves after `ms`; rejects with `signal.reason` (an `AbortError` by default) when aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
