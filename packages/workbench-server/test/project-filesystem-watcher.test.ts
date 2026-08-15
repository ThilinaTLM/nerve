import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { describe, it } from "node:test";
import {
  ProjectFilesystemWatcher,
  shouldInvalidateProjectPath,
} from "../src/domains/filesystem/project-filesystem-watcher.js";

type Timer = { at: number; callback: () => void; cancelled: boolean };

class FakeClock {
  nowMs = 0;
  timers: Timer[] = [];

  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> {
    const timer = { at: this.nowMs + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    (timer as unknown as Timer).cancelled = true;
  }

  advanceTo(nowMs: number): void {
    while (true) {
      const next = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= nowMs)
        .sort((left, right) => left.at - right.at)[0];
      if (!next) break;
      next.cancelled = true;
      this.nowMs = next.at;
      next.callback();
    }
    this.nowMs = nowMs;
  }
}

class FakeWatcher extends EventEmitter {
  closed = false;
  close(): void {
    this.closed = true;
  }
}

function setup(
  options: { maxProjects?: number; publisherThrows?: boolean } = {},
) {
  const clock = new FakeClock();
  const watches: Array<{
    path: string;
    watcher: FakeWatcher;
    listener: (event: string, filename: string | Buffer | null) => void;
  }> = [];
  const publications: unknown[] = [];
  const warnings: string[] = [];
  const watcher = new ProjectFilesystemWatcher(
    {
      publishBestEffort: (_type, data) => {
        if (options.publisherThrows) throw new Error("publish failed");
        publications.push(data);
      },
    },
    {
      clock,
      now: () => clock.nowMs,
      quietMs: 300,
      maxWaitMs: 2_000,
      maxProjects: options.maxProjects,
      watch: (path, _options, listener) => {
        const target = new FakeWatcher();
        watches.push({ path, watcher: target, listener });
        return target as unknown as FSWatcher;
      },
      onWarning: (message) => warnings.push(message),
    },
  );
  return { clock, publications, warnings, watcher, watches };
}

describe("ProjectFilesystemWatcher", () => {
  it("debounces bursts and filters noisy Git internals", () => {
    const { clock, publications, watcher, watches } = setup();
    watcher.watch("proj_one", "/repo");
    const emit = watches[0]?.listener;
    assert.ok(emit);

    emit("change", ".git/objects/aa/object");
    emit("change", ".git/index.lock");
    clock.advanceTo(1_000);
    assert.equal(publications.length, 0);

    emit("change", "src/a.ts");
    clock.advanceTo(1_200);
    emit("change", "src/b.ts");
    clock.advanceTo(1_499);
    assert.equal(publications.length, 0);
    clock.advanceTo(1_500);
    assert.deepEqual(publications, [
      { projectId: "proj_one", source: "filesystem" },
    ]);

    assert.equal(shouldInvalidateProjectPath(".git/index"), true);
    assert.equal(shouldInvalidateProjectPath(".git/refs/heads/main"), true);
    assert.equal(shouldInvalidateProjectPath(null), true);
  });

  it("flushes continuous changes at the maximum wait", () => {
    const { clock, publications, watcher, watches } = setup();
    watcher.watch("proj_one", "/repo");
    const emit = watches[0]?.listener;
    assert.ok(emit);

    emit("change", "a.ts");
    for (let at = 250; at < 2_000; at += 250) {
      clock.advanceTo(at);
      emit("change", "a.ts");
    }
    clock.advanceTo(2_000);
    assert.equal(publications.length, 1);
  });

  it("deduplicates, replaces, and evicts watched projects", () => {
    const { watcher, watches } = setup({ maxProjects: 1 });
    watcher.watch("proj_one", "/one");
    watcher.watch("proj_one", "/one");
    assert.equal(watches.length, 1);

    watcher.watch("proj_one", "/replacement");
    assert.equal(watches[0]?.watcher.closed, true);
    watcher.watch("proj_two", "/two");
    assert.equal(watches[1]?.watcher.closed, true);
    watcher.close();
    assert.equal(watches[2]?.watcher.closed, true);
  });

  it("contains errors and cancels pending changes on close", () => {
    const { clock, warnings, watcher, watches } = setup({
      publisherThrows: true,
    });
    watcher.watch("proj_one", "/repo");
    watches[0]?.listener("change", "a.ts");
    clock.advanceTo(300);
    assert.deepEqual(warnings, ["Could not publish project filesystem change"]);

    watches[0]?.listener("change", "b.ts");
    watcher.close();
    clock.advanceTo(3_000);
    assert.equal(warnings.length, 1);
    assert.equal(watches[0]?.watcher.closed, true);
  });
});
