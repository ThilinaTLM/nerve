import assert from "node:assert/strict";
import { it } from "node:test";
import { capabilityToolGroupsFor } from "./capability-tool-labels";

it("keeps web search/fetch and Jira/Confluence independently controllable", () => {
  const groups = capabilityToolGroupsFor([
    "web_search",
    "web_fetch",
    "jira",
    "confluence",
  ]);
  assert.deepEqual(
    groups.map((group) => group.names),
    [["web_search"], ["web_fetch"], ["jira"], ["confluence"]],
  );
});
