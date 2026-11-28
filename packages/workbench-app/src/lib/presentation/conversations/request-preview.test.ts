import assert from "node:assert/strict";
import test from "node:test";
import { toolDefinitionsMarkdown } from "./request-preview";

void test("tool definitions render as a heading, the description and a JSON schema block per tool", () => {
  assert.equal(
    toolDefinitionsMarkdown([
      {
        name: "read",
        description: "Read a file.\n",
        parameters: { type: "object", required: ["path"] },
      },
      { name: "ls", description: "List.", parameters: {} },
    ]),
    [
      "# read",
      "",
      "Read a file.",
      "",
      "```json",
      "{",
      '  "type": "object",',
      '  "required": [',
      '    "path"',
      "  ]",
      "}",
      "```",
      "",
      "# ls",
      "",
      "List.",
      "",
      "```json",
      "{}",
      "```",
      "",
    ].join("\n"),
  );
});
