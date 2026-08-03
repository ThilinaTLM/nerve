type UpdateWindow = Pick<
  Window,
  "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval"
>;

type UpdateDocument = Pick<
  Document,
  "addEventListener" | "removeEventListener" | "visibilityState"
>;

export function startPwaUpdateScheduler(options: {
  checkForUpdate: () => void | Promise<void>;
  intervalMs?: number;
  minimumCheckIntervalMs?: number;
  now?: () => number;
  window?: UpdateWindow;
  document?: UpdateDocument;
}): () => void {
  const targetWindow = options.window ?? window;
  const targetDocument = options.document ?? document;
  const now = options.now ?? Date.now;
  const minimumCheckIntervalMs = options.minimumCheckIntervalMs ?? 60_000;
  let lastCheckAt = Number.NEGATIVE_INFINITY;
  let checkInFlight = false;

  const checkWhileVisible = (): void => {
    if (targetDocument.visibilityState !== "visible" || checkInFlight) return;

    const checkedAt = now();
    if (checkedAt - lastCheckAt < minimumCheckIntervalMs) return;

    lastCheckAt = checkedAt;
    checkInFlight = true;
    void Promise.resolve()
      .then(options.checkForUpdate)
      .catch(() => undefined)
      .finally(() => {
        checkInFlight = false;
      });
  };

  const timer = targetWindow.setInterval(
    checkWhileVisible,
    options.intervalMs ?? 60 * 60_000,
  );
  targetWindow.addEventListener("focus", checkWhileVisible);
  targetWindow.addEventListener("online", checkWhileVisible);
  targetDocument.addEventListener("visibilitychange", checkWhileVisible);

  return () => {
    targetWindow.clearInterval(timer);
    targetWindow.removeEventListener("focus", checkWhileVisible);
    targetWindow.removeEventListener("online", checkWhileVisible);
    targetDocument.removeEventListener("visibilitychange", checkWhileVisible);
  };
}
