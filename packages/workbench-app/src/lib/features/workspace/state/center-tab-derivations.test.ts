import assert from "node:assert/strict";
import { test } from "node:test";
import { activeCenterTabId, centerTabIds } from "./center-tab-derivations";

const tabs = [
  { kind: "conversation", id: "a" },
  { kind: "file", id: "file" },
  { kind: "conversation", id: "b" },
  { kind: "settings", id: "settings" },
] as const;

test("derives feature tab identities from canonical center tabs", () => {
  assert.deepEqual(centerTabIds([...tabs], "conversation"), ["a", "b"]);
  assert.deepEqual(centerTabIds([...tabs], "file"), ["file"]);
  assert.equal(activeCenterTabId(tabs[0], "conversation"), "a");
  assert.equal(activeCenterTabId(tabs[1], "conversation"), undefined);
});
