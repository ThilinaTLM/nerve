import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterCommandItems } from "./command-filter.js";

const items = [
  { key: "model", label: "Model and reasoning", group: "Settings" },
  {
    key: "tool:jira",
    label: "Jira",
    group: "Tools",
    keywords: ["mcp", "atlassian"],
  },
  { key: "tool:web", label: "Web search", group: "Tools" },
  { key: "skill:testing", label: "Testing", group: "Skills" },
];

const keys = (query: string) =>
  filterCommandItems(items, query).map((group) => [
    group.group,
    group.items.map((item) => item.key),
  ]);

describe("filterCommandItems", () => {
  it("groups every item in first-appearance order without a query", () => {
    assert.deepEqual(keys("  "), [
      ["Settings", ["model"]],
      ["Tools", ["tool:jira", "tool:web"]],
      ["Skills", ["skill:testing"]],
    ]);
  });

  it("matches a group name to the whole group", () => {
    assert.deepEqual(keys("TOOLS"), [["Tools", ["tool:jira", "tool:web"]]]);
  });

  it("matches labels and hidden keywords", () => {
    assert.deepEqual(keys("jira"), [["Tools", ["tool:jira"]]]);
    assert.deepEqual(keys("atlassian"), [["Tools", ["tool:jira"]]]);
  });

  it("requires every term, across group, label, and keywords", () => {
    assert.deepEqual(keys("tools web"), [["Tools", ["tool:web"]]]);
    assert.deepEqual(keys("skills web"), []);
  });
});
