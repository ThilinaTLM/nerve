import assert from "node:assert/strict";
import { test } from "node:test";
import { startFileExplorerRefreshScheduler } from "./file-explorer-refresh-scheduler";

test("refreshes only while visible and cleans up listeners", () => {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  let interval: (() => void) | undefined;
  let visible = true;
  let refreshes = 0;
  const stop = startFileExplorerRefreshScheduler({
    refresh: () => {
      refreshes += 1;
    },
    window: {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      setInterval: ((callback: TimerHandler) => {
        interval = callback as () => void;
        return 1;
      }) as Window["setInterval"],
      clearInterval: (() => undefined) as Window["clearInterval"],
    },
    document: {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener:
        documentTarget.removeEventListener.bind(documentTarget),
      get visibilityState() {
        return visible ? "visible" : "hidden";
      },
    },
  });

  interval?.();
  windowTarget.dispatchEvent(new Event("focus"));
  assert.equal(refreshes, 2);
  visible = false;
  interval?.();
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(refreshes, 2);
  stop();
  visible = true;
  windowTarget.dispatchEvent(new Event("focus"));
  assert.equal(refreshes, 2);
});
