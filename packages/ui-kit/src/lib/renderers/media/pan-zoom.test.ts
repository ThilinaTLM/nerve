import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SCALE, fitTransform, zoomTransform } from "./pan-zoom.js";

describe("pan and zoom", () => {
  it("fits and centers content inside the padding", () => {
    assert.deepEqual(
      fitTransform(
        { width: 400, height: 300 },
        { width: 720, height: 260 },
        20,
      ),
      { scale: 0.5, x: 20, y: 85 },
    );
  });

  it("caps the fit scale so small images stay at their natural size", () => {
    assert.equal(
      fitTransform({ width: 800, height: 600 }, { width: 16, height: 16 }, 0, 1)
        .scale,
      1,
    );
    assert.equal(
      fitTransform({ width: 8000, height: 6000 }, { width: 1, height: 1 }, 0)
        .scale,
      MAX_SCALE,
    );
  });

  it("zooms around the pointer", () => {
    const next = zoomTransform({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    assert.deepEqual(next, { scale: 2, x: -100, y: -50 });
  });
});
