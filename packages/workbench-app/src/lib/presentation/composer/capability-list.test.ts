import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilityBodyHeight,
  filterCapabilityRows,
  showCapabilitySearch,
} from "./capability-list";
import {
  capabilityToolGroupsFor,
  capabilityToolGroupsForTab,
} from "./capability-tool-labels";
import { capabilityResetPatch } from "./capability-origin";

describe("showCapabilitySearch", () => {
  it("stays hidden for a short active list, including the threshold", () => {
    assert.equal(showCapabilitySearch(0), false);
    assert.equal(showCapabilitySearch(7), false);
    assert.equal(showCapabilitySearch(8), false);
  });

  it("appears only for a long active list", () => {
    // Switching from 15 skills to 7 tools must hide the skill search field.
    assert.equal(showCapabilitySearch(15), true);
    assert.equal(showCapabilitySearch(7), false);
    assert.equal(showCapabilitySearch(9), true);
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

describe("delegation tab ownership", () => {
  it("excludes the master from tool counts and filters without changing its canonical registry", () => {
    const tools = [
      "subagents",
      "web_search",
      "web_fetch",
      "python_exec",
    ] as const;
    const optional = capabilityToolGroupsForTab(tools, "tools");
    assert.deepEqual(
      optional.map((group) => group.key),
      ["web", "python_exec"],
    );
    assert.deepEqual(filterCapabilityRows(optional, "sub-agents"), []);
    assert.deepEqual(capabilityToolGroupsForTab(tools, "subagents"), [
      { key: "subagents", label: "Sub-agents", names: ["subagents"] },
    ]);
    assert.equal(capabilityToolGroupsFor(tools).length, 3);
  });

  it("resets only the master's capability value, not profile fields", () => {
    assert.deepEqual(capabilityResetPatch(["subagents"]), {
      tools: { subagents: { enabled: null } },
    });
    assert.deepEqual(
      capabilityToolGroupsForTab(["python_exec"], "subagents"),
      [],
    );
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
