import assert from "node:assert/strict";
import { test } from "node:test";

import { placeSelectionToolbar } from "./selection-toolbar-position.js";

const container = { left: 100, top: 50, right: 700, bottom: 650 };
const toolbar = { width: 120, height: 30 };

test("centers the toolbar above the selection", () => {
  const selection = { left: 300, top: 300, right: 400, bottom: 320 };
  assert.deepEqual(placeSelectionToolbar(selection, container, toolbar), {
    x: 250,
    y: 214,
    side: "above",
  });
});

test("flips below and clamps to the container edge near the top-left", () => {
  const selection = { left: 100, top: 60, right: 120, bottom: 80 };
  assert.deepEqual(placeSelectionToolbar(selection, container, toolbar), {
    x: 68,
    y: 36,
    side: "below",
  });
});
