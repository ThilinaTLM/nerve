import assert from "node:assert/strict";
import { it } from "node:test";
import { capabilityToolGroupsFor } from "./capability-tool-labels";

it("keeps web search/fetch and quick script independently controllable", () => {
  const groups = capabilityToolGroupsFor([
    "web_search",
    "web_fetch",
    "quick_script",
  ]);
  assert.deepEqual(
    groups.map((group) => group.names),
    [["web_search"], ["web_fetch"], ["quick_script"]],
  );
});
