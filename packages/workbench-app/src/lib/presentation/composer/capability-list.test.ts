import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilityBodyHeight,
  capabilityDecisionOrigin,
  filterCapabilityRows,
  showCapabilitySearch,
} from "./capability-list";
import { capabilityToolGroupsFor } from "./capability-tool-labels";

describe("capabilityDecisionOrigin", () => {
  it("uses conversation, then project, then user precedence", () => {
    assert.equal(capabilityDecisionOrigin(true, false), "conversation");
    assert.equal(capabilityDecisionOrigin(undefined, true), "project");
    assert.equal(capabilityDecisionOrigin(undefined, undefined), "user");
  });

  it("treats explicit false values as overrides", () => {
    assert.equal(capabilityDecisionOrigin(false, true), "conversation");
    assert.equal(capabilityDecisionOrigin(undefined, false), "project");
  });
});

describe("showCapabilitySearch", () => {
  it("stays hidden while both tabs are short", () => {
    assert.equal(showCapabilitySearch(7, 8), false);
  });

  it("appears when either tab is long", () => {
    assert.equal(showCapabilitySearch(7, 14), true);
    assert.equal(showCapabilitySearch(20, 0), true);
  });
});

describe("capabilityBodyHeight", () => {
  it("keeps one height regardless of which tab is longer", () => {
    assert.equal(capabilityBodyHeight(7, 14), capabilityBodyHeight(14, 7));
  });

  it("holds a floor for short or empty lists", () => {
    assert.equal(capabilityBodyHeight(0, 0), "7.5rem");
    assert.equal(capabilityBodyHeight(2, 1), "7.5rem");
  });

  it("grows with the longer list up to the clamp", () => {
    assert.equal(capabilityBodyHeight(6, 2), "11rem");
    assert.equal(capabilityBodyHeight(7, 14), "16.25rem");
    assert.equal(capabilityBodyHeight(7, 120), capabilityBodyHeight(9, 9));
  });
});

describe("capabilityToolGroupsFor", () => {
  it("presents web search and fetch as one Web access capability", () => {
    assert.deepEqual(capabilityToolGroupsFor(["web_search", "web_fetch"]), [
      {
        key: "web",
        label: "Web access",
        names: ["web_search", "web_fetch"],
        searchText: "Web search Web fetch",
      },
    ]);
  });

  it("keeps the group when only one web tool is available", () => {
    assert.deepEqual(capabilityToolGroupsFor(["web_fetch"])[0]?.names, [
      "web_fetch",
    ]);
  });
});

describe("filterCapabilityRows", () => {
  const rows = [
    { label: "Web access", searchText: "Web search Web fetch" },
    { label: "Image explanation" },
    { label: "nerve-data-debugging" },
  ];

  it("returns every row for an empty or blank query", () => {
    assert.deepEqual(filterCapabilityRows(rows, ""), rows);
    assert.deepEqual(filterCapabilityRows(rows, "   "), rows);
  });

  it("matches case-insensitively on labels and grouped tool names", () => {
    assert.deepEqual(filterCapabilityRows(rows, "SEARCH"), [rows[0]]);
    assert.deepEqual(filterCapabilityRows(rows, "fetch"), [rows[0]]);
    assert.deepEqual(filterCapabilityRows(rows, " debug "), [rows[2]]);
  });

  it("returns nothing when no label matches", () => {
    assert.deepEqual(filterCapabilityRows(rows, "python"), []);
  });
});
