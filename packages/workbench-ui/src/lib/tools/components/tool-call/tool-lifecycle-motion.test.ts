import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createToolLifecycleMotion,
  resolveToolLifecycleMotionPlan,
} from "./tool-lifecycle-motion";

describe("resolveToolLifecycleMotionPlan", () => {
  it("uses height motion for sparse and compact structural changes", () => {
    const standard = resolveToolLifecycleMotionPlan({
      profile: "standard",
      fromHeight: 40,
      targetHeight: 120,
      reducedMotion: false,
      visible: true,
    });
    assert.equal(standard.animateHeight, true);
    assert.equal(standard.animateContent, true);
    assert.equal(standard.durationMs, 180);
    assert.equal(standard.settleOffsetPx, 2);

    const compact = resolveToolLifecycleMotionPlan({
      profile: "compact",
      fromHeight: 40,
      targetHeight: 120,
      reducedMotion: false,
      visible: true,
    });
    assert.equal(compact.animateHeight, true);
    assert.equal(compact.durationMs, 120);
    assert.equal(compact.settleOffsetPx, 0);
  });

  it("commits minimal geometry immediately and animates opacity only", () => {
    const plan = resolveToolLifecycleMotionPlan({
      profile: "minimal",
      fromHeight: 40,
      targetHeight: 120,
      reducedMotion: false,
      visible: true,
    });
    assert.equal(plan.animateHeight, false);
    assert.equal(plan.animateContent, true);
    assert.equal(plan.durationMs, 90);
  });

  it("snaps hidden and reduced-motion cards", () => {
    for (const input of [
      { reducedMotion: true, visible: true },
      { reducedMotion: false, visible: false },
    ]) {
      const plan = resolveToolLifecycleMotionPlan({
        profile: "standard",
        fromHeight: 40,
        targetHeight: 120,
        ...input,
      });
      assert.equal(plan.animateHeight, false);
      assert.equal(plan.animateContent, false);
      assert.equal(plan.durationMs, 0);
    }
  });
});

type FakeAnimation = Animation & { cancelled: boolean };

function fakeStyle() {
  const removed: string[] = [];
  const style = {
    overflow: "",
    willChange: "",
    removeProperty(name: string) {
      removed.push(name);
      if (name === "overflow") this.overflow = "";
      if (name === "will-change") this.willChange = "";
      return "";
    },
  };
  return { style: style as unknown as CSSStyleDeclaration, removed };
}

function fakeElement(height: number) {
  const { style, removed } = fakeStyle();
  const animations: FakeAnimation[] = [];
  const element = {
    style,
    getBoundingClientRect: () => ({ height }),
    getClientRects: () => [{}],
    animate: () => {
      const animation = {
        cancelled: false,
        cancel: () => {
          animation.cancelled = true;
        },
        finished: new Promise<Animation>(() => undefined),
      } as unknown as FakeAnimation;
      animations.push(animation);
      return animation;
    },
  } as unknown as HTMLElement;
  return { element, animations, removed };
}

describe("createToolLifecycleMotion", () => {
  it("cancels active animations and removes temporary styles on snap", () => {
    const outer = fakeElement(40);
    const content = fakeElement(120);
    const motion = createToolLifecycleMotion(outer.element, content.element);

    motion.transition(40, false, "standard");
    assert.equal(outer.animations.length, 1);
    assert.equal(content.animations.length, 1);
    assert.equal(outer.element.style.overflow, "hidden");

    motion.snap();
    assert.equal(outer.animations[0]?.cancelled, true);
    assert.equal(content.animations[0]?.cancelled, true);
    assert.equal(outer.element.style.overflow, "");
    assert.ok(outer.removed.includes("will-change"));
    assert.ok(content.removed.includes("will-change"));
  });

  it("rebases an interrupted transition from the caller's current height", () => {
    const outer = fakeElement(40);
    const content = fakeElement(120);
    const motion = createToolLifecycleMotion(outer.element, content.element);

    motion.transition(40, false, "standard");
    content.element.getBoundingClientRect = () => ({ height: 180 }) as DOMRect;
    motion.transition(84, false, "compact");

    assert.equal(outer.animations.length, 2);
    assert.equal(outer.animations[0]?.cancelled, true);
    assert.equal(content.animations[0]?.cancelled, true);
    motion.destroy();
    assert.equal(outer.animations[1]?.cancelled, true);
  });
});
