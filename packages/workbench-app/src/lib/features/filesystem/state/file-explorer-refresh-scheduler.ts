type RefreshWindow = Pick<
  Window,
  | "addEventListener"
  | "removeEventListener"
  | "setInterval"
  | "clearInterval"
  | "setTimeout"
  | "clearTimeout"
>;
type RefreshDocument = Pick<
  Document,
  "addEventListener" | "removeEventListener" | "visibilityState"
>;

export type FileExplorerRefreshScheduler = {
  requestRefresh(): void;
  stop(): void;
};

export function startFileExplorerRefreshScheduler(options: {
  refresh: () => void | Promise<void>;
  intervalMs?: number;
  minimumRefreshIntervalMs?: number;
  now?: () => number;
  window?: RefreshWindow;
  document?: RefreshDocument;
}): FileExplorerRefreshScheduler {
  const targetWindow = options.window ?? window;
  const targetDocument = options.document ?? document;
  const now = options.now ?? Date.now;
  const minimumRefreshIntervalMs = options.minimumRefreshIntervalMs ?? 1_000;
  let lastRefreshStartedAt = Number.NEGATIVE_INFINITY;
  let refreshInFlight = false;
  let refreshPending = false;
  let stopped = false;
  let pendingTimer: ReturnType<Window["setTimeout"]> | undefined;

  const drain = (): void => {
    if (stopped || refreshInFlight || !refreshPending) return;
    if (targetDocument.visibilityState !== "visible") {
      refreshPending = false;
      return;
    }

    const delay = minimumRefreshIntervalMs - (now() - lastRefreshStartedAt);
    if (delay > 0) {
      pendingTimer ??= targetWindow.setTimeout(() => {
        pendingTimer = undefined;
        drain();
      }, delay);
      return;
    }

    if (pendingTimer !== undefined) {
      targetWindow.clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    refreshPending = false;
    lastRefreshStartedAt = now();
    refreshInFlight = true;
    void Promise.resolve()
      .then(options.refresh)
      .catch(() => undefined)
      .finally(() => {
        refreshInFlight = false;
        drain();
      });
  };

  const requestRefresh = (): void => {
    if (stopped || targetDocument.visibilityState !== "visible") return;
    refreshPending = true;
    drain();
  };

  const interval = targetWindow.setInterval(
    requestRefresh,
    options.intervalMs ?? 20_000,
  );
  targetWindow.addEventListener("focus", requestRefresh);
  targetDocument.addEventListener("visibilitychange", requestRefresh);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    refreshPending = false;
    targetWindow.clearInterval(interval);
    if (pendingTimer !== undefined) targetWindow.clearTimeout(pendingTimer);
    pendingTimer = undefined;
    targetWindow.removeEventListener("focus", requestRefresh);
    targetDocument.removeEventListener("visibilitychange", requestRefresh);
  };

  return { requestRefresh, stop };
}
