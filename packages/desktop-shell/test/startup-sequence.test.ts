import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runStartupSequence } from "../src/app/startup-sequence.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("runStartupSequence", () => {
  it("overlaps network setup with daemon launch and gates final navigation", async () => {
    const network = deferred<void>();
    const daemon = deferred<{ url: string }>();
    const prepared = deferred<void>();
    const events: string[] = [];
    const running = runStartupSequence({
      showLoadingWindow: async () => {
        events.push("loading");
      },
      connectDaemon: async () => {
        events.push("connect");
        return daemon.promise;
      },
      networkReady: network.promise,
      prepareDaemonConnection: async () => {
        events.push("prepare");
        return prepared.promise;
      },
      canNavigate: () => true,
      navigate: async () => {
        events.push("navigate");
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(events, ["loading", "connect"]);
    daemon.resolve({ url: "http://127.0.0.1:3747" });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(events, ["loading", "connect", "prepare"]);
    prepared.resolve();
    await Promise.resolve();
    assert.equal(events.includes("navigate"), false);
    network.resolve();

    const result = await running;
    assert.equal(result.navigated, true);
    assert.equal(events.at(-1), "navigate");
  });

  it("does not navigate after the window is destroyed", async () => {
    let navigated = false;
    const result = await runStartupSequence({
      showLoadingWindow: async () => undefined,
      connectDaemon: async () => ({ url: "http://127.0.0.1:3747" }),
      networkReady: Promise.resolve(),
      prepareDaemonConnection: async () => undefined,
      canNavigate: () => false,
      navigate: async () => {
        navigated = true;
      },
    });
    assert.equal(result.navigated, false);
    assert.equal(navigated, false);
  });

  it("propagates prerequisite failures without navigating", async () => {
    let navigated = false;
    await assert.rejects(
      runStartupSequence({
        showLoadingWindow: async () => undefined,
        connectDaemon: async () => ({ url: "http://127.0.0.1:3747" }),
        networkReady: Promise.resolve(),
        prepareDaemonConnection: async () => {
          throw new Error("cookie failed");
        },
        canNavigate: () => true,
        navigate: async () => {
          navigated = true;
        },
      }),
      /cookie failed/,
    );
    assert.equal(navigated, false);
  });
});
