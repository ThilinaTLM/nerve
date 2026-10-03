import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSpringDriver,
  HeightSpring,
  MAX_STEP_MS,
} from "./height-spring.js";

const FRAME_MS = 1000 / 60;

describe("HeightSpring", () => {
  it("reaches the target without overshoot within the response time", () => {
    const spring = new HeightSpring(0);
    spring.retarget(108);
    let max = 0;
    let frames = 0;
    let nearFrames: number | undefined;
    while (!spring.step(FRAME_MS, 280)) {
      max = Math.max(max, spring.height);
      frames += 1;
      if (nearFrames === undefined && 108 - spring.height < 108 * 0.01) {
        nearFrames = frames;
      }
      assert.ok(frames < 200, "never settled");
    }
    assert.ok(max <= 108, `overshoot to ${max}`);
    assert.ok(
      (nearFrames ?? frames) * FRAME_MS <= 280 * 1.1,
      `99% reached after ${nearFrames} frames`,
    );
    assert.equal(spring.height, 108);
  });

  it("keeps velocity when retargeted mid-flight", () => {
    const spring = new HeightSpring(0);
    spring.retarget(18);
    for (let index = 0; index < 5; index += 1) spring.step(FRAME_MS, 280);
    const before = spring.height;
    spring.retarget(36);
    spring.step(FRAME_MS, 280);
    const firstStep = spring.height - before;
    assert.ok(firstStep > 0);
    // No restart: the next frame continues smoothly instead of jumping.
    const mid = spring.height;
    spring.step(FRAME_MS, 280);
    assert.ok(Math.abs(spring.height - mid - firstStep) < 4);
  });

  it("never covers more than one capped step on a stalled frame", () => {
    const stalled = new HeightSpring(0);
    stalled.retarget(150);
    stalled.step(200, 120);
    const capped = new HeightSpring(0);
    capped.retarget(150);
    capped.step(MAX_STEP_MS, 120);
    assert.equal(stalled.height, capped.height);
    assert.ok(stalled.height < 150 * 0.5, `jumped to ${stalled.height}`);
  });

  it("snaps when the response is zero", () => {
    const spring = new HeightSpring(10);
    spring.retarget(50);
    assert.equal(spring.step(FRAME_MS, 0), true);
    assert.equal(spring.height, 50);
  });
});

describe("createSpringDriver", () => {
  function fakeFrames() {
    const pending = new Map<number, (timestamp: number) => void>();
    let next = 1;
    let now = 0;
    return {
      frames: {
        request(callback: (timestamp: number) => void) {
          pending.set(next, callback);
          return next++;
        },
        cancel(handle: number) {
          pending.delete(handle);
        },
      },
      get pending() {
        return pending.size;
      },
      tick() {
        now += FRAME_MS;
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(now);
      },
    };
  }

  it("refuses clients beyond the concurrency cap", () => {
    const fake = fakeFrames();
    const driver = createSpringDriver({ frames: fake.frames, maxActive: 2 });
    const client = () => ({ step: () => false });
    assert.equal(driver.add(client()), true);
    assert.equal(driver.add(client()), true);
    assert.equal(driver.add(client()), false);
    assert.equal(driver.activeCount, 2);
    assert.equal(fake.pending, 1);
  });

  it("stops scheduling frames once every client finishes", () => {
    const fake = fakeFrames();
    const driver = createSpringDriver({ frames: fake.frames });
    let remaining = 3;
    driver.add({ step: () => --remaining <= 0 });
    fake.tick();
    fake.tick();
    assert.equal(fake.pending, 1);
    fake.tick();
    assert.equal(driver.activeCount, 0);
    assert.equal(fake.pending, 0);
  });
});
