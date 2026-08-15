import assert from "node:assert/strict";
import { test } from "node:test";
import {
  startGitRefreshLoop,
  type GitRefreshLoopBrowser,
} from "./git-refresh-loop";

test("Git refresh loop owns one timer and one browser listener pair", () => {
  let visible = true;
  let interval: (() => void) | undefined;
  let focus: (() => void) | undefined;
  let visibility: (() => void) | undefined;
  const removed: string[] = [];
  const calls: string[] = [];
  const browser: GitRefreshLoopBrowser = {
    visible: () => visible,
    setInterval: (callback) => {
      interval = callback;
      return "timer";
    },
    clearInterval: (timer) => removed.push(String(timer)),
    addFocusListener: (listener) => (focus = listener),
    removeFocusListener: (listener) => {
      assert.equal(listener, focus);
      removed.push("focus");
    },
    addVisibilityListener: (listener) => (visibility = listener),
    removeVisibilityListener: (listener) => {
      assert.equal(listener, visibility);
      removed.push("visibility");
    },
  };
  const stop = startGitRefreshLoop(
    {
      pollPending: () => calls.push("poll"),
      refreshVisible: () => calls.push("visible"),
      refreshContext: () => calls.push("context"),
    },
    browser,
    10_000,
  );

  interval?.();
  focus?.();
  assert.deepEqual(calls, ["poll", "poll", "visible", "context"]);

  visible = false;
  interval?.();
  visibility?.();
  assert.deepEqual(calls, ["poll", "poll", "visible", "context"]);

  stop();
  assert.deepEqual(removed, ["timer", "focus", "visibility"]);
});
