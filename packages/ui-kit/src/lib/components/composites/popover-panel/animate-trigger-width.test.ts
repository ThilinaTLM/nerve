import assert from "node:assert/strict";
import { test } from "node:test";
import { animateTriggerWidth } from "./animate-trigger-width.js";

test("trigger width animation measures intrinsic layout and releases it at rest", (t) => {
  let mutate = () => {};
  let resized = () => {};
  let motionChanged = () => {};
  let intrinsic = "100px";
  let rendered: string | undefined;
  let parentWidth = 500;
  let disconnected = 0;
  const animations: {
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
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
  mockGlobal("getComputedStyle", () => ({
    width: rendered ?? intrinsic,
  }));
  mockGlobal("window", {
    matchMedia: () => motion,
  });
  mockGlobal("document", {});
  mockGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  );
  mockGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  );
  const node = {
    parentElement: {
      getBoundingClientRect: () => ({ width: parentWidth }),
    },
    getClientRects: () => [{}],
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = {
        frames,
        options,
        cancel: () => {
          rendered = undefined;
        },
      };
      animations.push(animation);
      rendered = String(frames[0].width);
      return animation;
    },
  } as unknown as HTMLElement;

  const destroy = animateTriggerWidth(node);
  assert.equal(animations.length, 0, "no mount animation");
  resized();
  assert.equal(animations.length, 0, "initial resize delivery is inert");

  intrinsic = "180px";
  mutate();
  assert.deepEqual(animations[0].frames, [
    { width: "100px" },
    { width: "180px" },
  ]);
  assert.equal(animations[0].options.duration, 200);

  rendered = "130px";
  intrinsic = "220px";
  mutate();
  assert.deepEqual(
    animations[1].frames,
    [{ width: "130px" }, { width: "220px" }],
    "interruption starts at the rendered width but measures unconstrained",
  );

  // A container resize must cancel instead of retaining a stale pixel width.
  parentWidth = 300;
  intrinsic = "90px";
  resized();
  assert.equal(rendered, undefined);
  intrinsic = "120px";
  mutate();
  assert.equal(animations[2].frames[0].width, "90px");

  // Finished WAAPI effects no longer apply; future changes use intrinsic width.
  rendered = undefined;
  animations[2].onfinish?.();
  intrinsic = "150px";
  mutate();
  assert.equal(animations[3].frames[0].width, "120px");

  motion.matches = true;
  motionChanged();
  assert.equal(
    rendered,
    undefined,
    "reduced motion cancels in-flight animation",
  );
  intrinsic = "200px";
  mutate();
  assert.equal(animations.length, 4, "reduced motion skips new animations");

  destroy();
  assert.equal(disconnected, 2);
});
