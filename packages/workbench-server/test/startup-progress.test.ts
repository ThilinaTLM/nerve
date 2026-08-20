import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DaemonStartupProgress } from "@nervekit/contracts";
import { StartupProgressReporter } from "../src/infrastructure/startup/startup-progress.js";

describe("startup progress reporter", () => {
  it("owns a referenced heartbeat and preserves the latest phase", () => {
    const events: DaemonStartupProgress[] = [];
    let heartbeat: (() => void) | undefined;
    let unrefCalled = false;
    let cleared = false;
    const handle = {
      unref() {
        unrefCalled = true;
      },
    } as unknown as ReturnType<typeof setInterval>;
    const reporter = new StartupProgressReporter({
      write: (event) => events.push(event),
      setInterval: ((callback: () => void) => {
        heartbeat = callback;
        return handle;
      }) as typeof setInterval,
      clearInterval: ((value: ReturnType<typeof setInterval>) => {
        assert.equal(value, handle);
        cleared = true;
      }) as typeof clearInterval,
    });

    reporter.start();
    reporter.update("storage-migration", "Upgrading workspace storage");
    heartbeat?.();
    reporter.stop();

    assert.equal(unrefCalled, false);
    assert.equal(cleared, true);
    assert.deepEqual(
      events.map(({ kind, phase, message }) => ({ kind, phase, message })),
      [
        {
          kind: "progress",
          phase: "starting",
          message: "Preparing Nerve services",
        },
        {
          kind: "progress",
          phase: "storage-migration",
          message: "Upgrading workspace storage",
        },
        {
          kind: "heartbeat",
          phase: "storage-migration",
          message: "Upgrading workspace storage",
        },
      ],
    );
  });
});
