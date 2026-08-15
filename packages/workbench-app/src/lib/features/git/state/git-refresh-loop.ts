export type GitRefreshLoopActions = {
  pollPending: () => void;
  refreshVisible: () => void;
  refreshContext: () => void;
};

export type GitRefreshLoopBrowser = {
  visible: () => boolean;
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (timer: unknown) => void;
  addFocusListener: (listener: () => void) => void;
  removeFocusListener: (listener: () => void) => void;
  addVisibilityListener: (listener: () => void) => void;
  removeVisibilityListener: (listener: () => void) => void;
};

export function startGitRefreshLoop(
  actions: GitRefreshLoopActions,
  browser: GitRefreshLoopBrowser,
  intervalMs: number,
): () => void {
  const poll = () => {
    if (browser.visible()) actions.pollPending();
  };
  const refresh = () => {
    if (!browser.visible()) return;
    actions.pollPending();
    actions.refreshVisible();
    actions.refreshContext();
  };
  const timer = browser.setInterval(poll, intervalMs);
  browser.addFocusListener(refresh);
  browser.addVisibilityListener(refresh);
  return () => {
    browser.clearInterval(timer);
    browser.removeFocusListener(refresh);
    browser.removeVisibilityListener(refresh);
  };
}
