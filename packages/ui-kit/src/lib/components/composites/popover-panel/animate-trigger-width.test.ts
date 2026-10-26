import assert from "node:assert/strict";
import { test } from "node:test";
import { createTriggerWidthAnimation } from "./animate-trigger-width.js";

test("trigger width animation starts from the captured on-screen width", (t) => {
  let intrinsic = "100px";
  let rendered: string | undefined;
  let motionChanged = () => {};
  const animations: {
    frames: Keyframe[];
    cancel: () => void;
    onfinish?: () => void;
  }[] = [];
  const motion = {
    matches: false,
    addEventListener: (_: string, callback: () => void) => {
      motionChanged = callback;
    },
    removeEventListener: () => {},
  };
  function mockGlobal(name: string, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  mockGlobal("getComputedStyle", () => ({ width: rendered ?? intrinsic }));
  mockGlobal("window", { matchMedia: () => motion });
  const node = {
    getClientRects: () => [{}],
    animate(frames: Keyframe[]) {
      const animation = {
        frames,
        cancel: () => {
          rendered = undefined;
        },
      };
      animations.push(animation);
      rendered = String(frames[0].width);
      return animation;
    },
  } as unknown as HTMLElement;

  const animation = createTriggerWidthAnimation(node);

  animation.play();
  assert.equal(animations.length, 0, "play without capture is inert");

  animation.capture();
  intrinsic = "180px";
  animation.play();
  assert.deepEqual(animations[0].frames, [
    { width: "100px" },
    { width: "180px" },
  ]);

  // Interrupting continues from the rendered width, ends at the natural one.
  rendered = "130px";
  animation.capture();
  intrinsic = "220px";
  animation.play();
  assert.deepEqual(animations[1].frames, [
    { width: "130px" },
    { width: "220px" },
  ]);

  // Layout changes outside capture/play never animate and never go stale.
  animations[1].onfinish?.();
  rendered = undefined;
  intrinsic = "150px";
  animation.capture();
  intrinsic = "150px";
  animation.play();
  assert.equal(animations.length, 2, "unchanged width does not animate");
  intrinsic = "170px";
  animation.capture();
  intrinsic = "200px";
  animation.play();
  assert.equal(animations[2].frames[0].width, "170px");

  motion.matches = true;
  motionChanged();
  assert.equal(rendered, undefined, "reduced motion cancels in-flight");
  animation.capture();
  intrinsic = "300px";
  animation.play();
  assert.equal(animations.length, 3, "reduced motion skips animation");
  animation.destroy();
});
