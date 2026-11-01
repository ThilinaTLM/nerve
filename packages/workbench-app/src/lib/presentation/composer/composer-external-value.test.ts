import assert from "node:assert/strict";
import { test } from "node:test";

import { externalValueChange } from "./composer-external-value.js";

test("appending text puts the caret after the appended text", () => {
  assert.deepEqual(externalValueChange("Hi", "Hi\n\n> quote\n\n"), {
    from: 2,
    to: 2,
    insert: "\n\n> quote\n\n",
    caret: 13,
  });
});

test("clearing the composer leaves the caret at the start", () => {
  assert.deepEqual(externalValueChange("draft", ""), {
    from: 0,
    to: 5,
    insert: "",
    caret: 0,
  });
});

test("replacing the middle only touches the differing span", () => {
  assert.deepEqual(externalValueChange("a b c", "a x c"), {
    from: 2,
    to: 3,
    insert: "x",
    caret: 3,
  });
});
