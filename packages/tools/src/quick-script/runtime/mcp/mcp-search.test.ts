import assert from "node:assert/strict";
import { test } from "node:test";
import type { McpTool } from "./mcp-port.js";
import { rankTools, renderArguments, toMatch } from "./mcp-search.js";

const tool = (
  server: string,
  name: string,
  description?: string,
  extra: Partial<McpTool> = {},
): McpTool => ({
  server,
  name,
  description,
  inputSchema: { type: "object" },
  ...extra,
});

void test("names rank above titles above descriptions, exact words above prefixes", () => {
  const ranked = rankTools(
    [
      tool("a", "list_things", "Creates an issue somewhere."),
      tool("a", "t", "x", { title: "Issue tracker" }),
      tool("a", "issues_search"),
      tool("a", "createIssue"),
    ],
    "issue",
  ).map((entry) => entry.name);
  assert.deepEqual(ranked, [
    "createIssue",
    "issues_search",
    "t",
    "list_things",
  ]);
});

void test("every query word must match; ties order by server then name", () => {
  const tools = [
    tool("b", "create_issue"),
    tool("a", "create_issue"),
    tool("a", "create_branch"),
  ];
  assert.deepEqual(
    rankTools(tools, "create issue").map((t) => `${t.server}/${t.name}`),
    ["a/create_issue", "b/create_issue"],
  );
  assert.deepEqual(
    rankTools(tools, "create").map((t) => `${t.server}/${t.name}`),
    ["a/create_branch", "a/create_issue", "b/create_issue"],
  );
  assert.deepEqual(rankTools(tools, "   "), []);
});

void test("the summary is the first sentence, capped at 200 characters", () => {
  assert.equal(
    toMatch(tool("s", "n", "Create an issue.\nThen more text.")).summary,
    "Create an issue.",
  );
  const long = toMatch(tool("s", "n", "word ".repeat(100))).summary;
  assert.equal(long.length, 200);
  assert.ok(long.endsWith("…"));
});

void test("arguments render optional, nested, enum, array and union fields on one line", () => {
  assert.equal(
    renderArguments({
      type: "object",
      required: ["owner", "title"],
      properties: {
        owner: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        state: { enum: ["open", "closed"] },
        id: { anyOf: [{ type: "string" }, { type: "integer" }] },
        ids: { type: "array", items: { type: ["string", "number"] } },
        "x-y": { type: "boolean" },
        assignee: {
          type: "object",
          required: ["login"],
          properties: {
            login: { type: "string" },
            meta: {
              type: "object",
              properties: {
                a: { type: "object", properties: { b: { type: "string" } } },
              },
            },
          },
        },
      },
    }),
    'owner: string, title: string, body?: string, labels?: string[], state?: "open" | "closed", id?: string | integer, ids?: (string | number)[], "x-y"?: boolean, assignee?: { login: string, meta?: { a?: object } }',
  );
  assert.equal(renderArguments({ type: "object" }), "");
});
