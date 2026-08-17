import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Check } from "typebox/value";
import {
  allToolDefinitions,
  requireToolDefinition,
} from "../src/catalog/manifest.js";

const validActionArguments: Record<string, Record<string, unknown>> = {
  jira_manage_comment: { action: "create", issue_key: "PROJ-1" },
  jira_manage_worklog: { action: "create", issue_key: "PROJ-1" },
  jira_manage_issue_link: { action: "create", issue_key: "PROJ-1" },
  jira_manage_sprint: { action: "create" },
  jira_manage_backlog: { action: "move_to_backlog", issue_key: "PROJ-1" },
  confluence_manage_comment: { action: "create", kind: "footer" },
  confluence_manage_page: { action: "trash", page_id: "123" },
  confluence_manage_label: { action: "add", page_id: "123", label: "one" },
  confluence_manage_restriction: {
    action: "clear_operation",
    page_id: "123",
    operation: "read",
  },
  confluence_manage_attachment: { action: "upload", page_id: "123" },
};
const flattenedActionTools = new Set(Object.keys(validActionArguments));

describe("model-facing tool schema compatibility", () => {
  it("uses a JSON object root for every tool definition", () => {
    for (const definition of allToolDefinitions) {
      const serialized = JSON.parse(JSON.stringify(definition.parameters)) as {
        type?: unknown;
      };
      assert.equal(serialized.type, "object", definition.name);
    }
  });

  it("does not expose top-level schema composition for action tools", () => {
    for (const definition of allToolDefinitions) {
      if (!flattenedActionTools.has(definition.name)) continue;
      const schema = definition.parameters as Record<string, unknown>;
      assert.equal(schema.type, "object", definition.name);
      assert.equal(schema.anyOf, undefined, definition.name);
      assert.equal(schema.oneOf, undefined, definition.name);
      assert.equal(schema.allOf, undefined, definition.name);
    }
  });

  it("keeps every flattened action property closed", () => {
    for (const [name, args] of Object.entries(validActionArguments)) {
      const schema = requireToolDefinition(name).parameters;
      assert.equal(Check(schema, args), true, name);
      assert.equal(
        Check(schema, { ...args, action: "unsupported" }),
        false,
        name,
      );
    }
  });
});
