import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentStep,
  calloutPlacement,
  filterGuideItems,
  shouldAutoOpenGuide,
} from "./guide-controller.js";

describe("onboarding guide policy", () => {
  it("opens once per ready startup generation when a version is unseen", () => {
    const base = {
      progressiveActive: true,
      settingsLoaded: true,
      completedVersion: 0,
      currentVersion: 1,
      generation: 2,
    };
    assert.equal(shouldAutoOpenGuide(base), true);
    assert.equal(
      shouldAutoOpenGuide({ ...base, consideredGeneration: 2 }),
      false,
    );
    assert.equal(
      shouldAutoOpenGuide({ ...base, progressiveActive: false }),
      false,
    );
    assert.equal(shouldAutoOpenGuide({ ...base, completedVersion: 1 }), false);
  });

  it("filters automatic runs by introduced version and replays all manually", () => {
    const items = [{ introducedIn: 1 }, { introducedIn: 2 }];
    assert.deepEqual(filterGuideItems(items, 1, false), [items[1]]);
    assert.deepEqual(filterGuideItems(items, 2, true), items);
  });

  it("clamps step navigation", () => {
    assert.equal(adjacentStep(0, 3, -1), 0);
    assert.equal(adjacentStep(1, 3, 1), 2);
    assert.equal(adjacentStep(2, 3, 1), 2);
  });
});

describe("tour callout placement", () => {
  const viewport = {
    viewportWidth: 1000,
    viewportHeight: 800,
    calloutWidth: 320,
    calloutHeight: 180,
  };

  it("places below when space is available", () => {
    const placement = calloutPlacement({
      ...viewport,
      compact: false,
      target: {
        top: 100,
        right: 300,
        bottom: 150,
        left: 100,
        width: 200,
        height: 50,
      },
    });
    assert.equal(placement.side, "bottom");
    assert.equal(placement.top, 162);
  });

  it("places beside a tall target when vertical placement would overlap", () => {
    const placement = calloutPlacement({
      ...viewport,
      calloutWidth: 240,
      compact: false,
      target: {
        top: 100,
        right: 700,
        bottom: 700,
        left: 300,
        width: 400,
        height: 600,
      },
    });
    assert.deepEqual(placement, {
      top: 310,
      left: 712,
      side: "right",
    });
  });

  it("uses a clamped bottom card on compact screens", () => {
    const placement = calloutPlacement({
      ...viewport,
      viewportWidth: 360,
      viewportHeight: 640,
      calloutWidth: 336,
      compact: true,
    });
    assert.deepEqual(placement, { top: 448, left: 12, side: "center" });
  });

  it("centers a targetless completion card", () => {
    const placement = calloutPlacement({
      ...viewport,
      compact: false,
      centered: true,
    });
    assert.deepEqual(placement, { top: 310, left: 340, side: "center" });
  });
});
