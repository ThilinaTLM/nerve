import assert from "node:assert/strict";
import test from "node:test";
import { relativeItemRectangle } from "./item-collection.js";

test("relativeItemRectangle projects a target into collection coordinates", () => {
  assert.deepEqual(
    relativeItemRectangle(
      { left: 40, top: 20, width: 400, height: 300 },
      { left: 64, top: 72, width: 180, height: 36 },
    ),
    { x: 24, y: 52, width: 180, height: 36 },
  );
});

test("relativeItemRectangle retains targets above or left of a scrolled viewport", () => {
  assert.deepEqual(
    relativeItemRectangle(
      { left: 20, top: 30, width: 240, height: 180 },
      { left: 8, top: -10, width: 200, height: 28 },
    ),
    { x: -12, y: -40, width: 200, height: 28 },
  );
});

test("relativeItemRectangle snaps fractional edges to whole pixels", () => {
  assert.deepEqual(
    relativeItemRectangle(
      { left: 10.4, top: 20.6, width: 400, height: 300 },
      { left: 74.7, top: 72.2, width: 180.3, height: 36.4 },
    ),
    { x: 64, y: 52, width: 181, height: 36 },
  );
});

test("relativeItemRectangle snaps to device pixels at fractional scale factors", () => {
  assert.deepEqual(
    relativeItemRectangle(
      { left: 10.4, top: 20.6, width: 400, height: 300 },
      { left: 74.7, top: 72.2, width: 180.3, height: 36.4 },
      2,
    ),
    { x: 64.5, y: 51.5, width: 180, height: 36.5 },
  );
});
test("relativeItemRectangle keeps edge-aligned outlines inside the collection", () => {
  const collection = {
    left: 8.796875,
    top: 10.796875,
    width: 346.828125,
    height: 48.375,
  };

  assert.deepEqual(
    relativeItemRectangle(
      collection,
      {
        left: collection.left,
        top: collection.top,
        width: collection.width,
        height: collection.height,
      },
      2,
    ),
    { x: 0, y: 0, width: collection.width, height: collection.height },
  );
});
