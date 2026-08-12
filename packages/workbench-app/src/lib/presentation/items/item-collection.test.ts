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
