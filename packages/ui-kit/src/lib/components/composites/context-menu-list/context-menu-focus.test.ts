import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRestoreMenuFocus } from "./context-menu-focus";

test("plain actions restore focus to the trigger for keyboard users", () => {
  assert.equal(
    shouldRestoreMenuFocus({ skipRequested: false, focusOutsideMenu: false }),
    true,
  );
});

test("focus-moving actions and an already-moved focus are left alone", () => {
  assert.equal(
    shouldRestoreMenuFocus({ skipRequested: true, focusOutsideMenu: false }),
    false,
  );
  assert.equal(
    shouldRestoreMenuFocus({ skipRequested: false, focusOutsideMenu: true }),
    false,
  );
});
