import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GitAutoRefreshScheduler,
  type GitAutoRefreshDemand,
} from "./git-auto-refresh-scheduler.js";
import { GIT_AUTO_REFRESH_COOLDOWN_MS } from "./git-refresh-policy.js";

type Timer = { at: number; callback: () => void; cancelled: boolean };

class FakeClock {
  nowMs = 0;
  timers: Timer[] = [];

  now(): number {
    return this.nowMs;
  }

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

function setup() {
  const clock = new FakeClock();
  const dispatches: Array<{ at: number; demand: GitAutoRefreshDemand }> = [];
  const scheduler = new GitAutoRefreshScheduler(
    GIT_AUTO_REFRESH_COOLDOWN_MS,
    (_key, demand) => dispatches.push({ at: clock.now(), demand }),
    clock,
  );
  return { clock, dispatches, scheduler };
}

describe("GitAutoRefreshScheduler", () => {
  it("dispatches first demand immediately and coalesces one trailing refresh", () => {
    const { clock, dispatches, scheduler } = setup();
    scheduler.schedule("repo", { overview: true });
    clock.advanceTo(5_000);
    scheduler.schedule("repo", { overview: true });
    clock.advanceTo(10_000);
    scheduler.schedule("repo", { overview: true });
    assert.deepEqual(dispatches, [{ at: 0, demand: { overview: true } }]);

    clock.advanceTo(20_000);
    assert.deepEqual(dispatches, [
      { at: 0, demand: { overview: true } },
      { at: 20_000, demand: { overview: true } },
    ]);
    clock.advanceTo(40_000);
    assert.equal(dispatches.length, 2);
  });

  it("merges targets while retaining independent cooldown boundaries", () => {
    const { clock, dispatches, scheduler } = setup();
    scheduler.schedule("repo", { overview: true });
    clock.advanceTo(5_000);
    scheduler.schedule("repo", { prs: true });
    clock.advanceTo(10_000);
    scheduler.schedule("repo", { overview: true, prs: true });

    clock.advanceTo(20_000);
    clock.advanceTo(25_000);
    assert.deepEqual(dispatches, [
      { at: 0, demand: { overview: true } },
      { at: 5_000, demand: { prs: true } },
      { at: 20_000, demand: { overview: true } },
      { at: 25_000, demand: { prs: true } },
    ]);
  });

  it("lets a direct refresh satisfy queued demand and reset eligibility", () => {
    const { clock, dispatches, scheduler } = setup();
    scheduler.schedule("repo", { prs: true });
    clock.advanceTo(5_000);
    scheduler.schedule("repo", { prs: true });
    clock.advanceTo(10_000);
    scheduler.noteDirectStart("repo", { prs: true });
    clock.advanceTo(11_000);
    scheduler.schedule("repo", { prs: true });

    clock.advanceTo(29_999);
    assert.deepEqual(dispatches, [{ at: 0, demand: { prs: true } }]);
    clock.advanceTo(30_000);
    assert.deepEqual(dispatches, [
      { at: 0, demand: { prs: true } },
      { at: 30_000, demand: { prs: true } },
    ]);
  });
});
