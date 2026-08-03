type RefreshWindow = Pick<
  Window,
  "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval"
>;
type RefreshDocument = Pick<
  Document,
  "addEventListener" | "removeEventListener" | "visibilityState"
>;

export function startFileExplorerRefreshScheduler(options: {
  refresh: () => void | Promise<void>;
  intervalMs?: number;
  window?: RefreshWindow;
  document?: RefreshDocument;
}): () => void {
  const targetWindow = options.window ?? window;
  const targetDocument = options.document ?? document;
  const refresh = (): void => {
    if (targetDocument.visibilityState === "visible") void options.refresh();
  };
  const timer = targetWindow.setInterval(refresh, options.intervalMs ?? 20_000);
  targetWindow.addEventListener("focus", refresh);
  targetDocument.addEventListener("visibilitychange", refresh);
  return () => {
    targetWindow.clearInterval(timer);
    targetWindow.removeEventListener("focus", refresh);
    targetDocument.removeEventListener("visibilitychange", refresh);
  };
}
