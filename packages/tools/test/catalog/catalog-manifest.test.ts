import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Check } from "typebox/value";
import {
  allToolDefinitions,
  requireToolDefinition,
} from "../../src/catalog/manifest.js";

const validActionArguments: Record<string, Record<string, unknown>> = {
  jira_manage_comment: { action: "create", issue_key: "PROJ-1" },
  jira_manage_worklog: { action: "create", issue_key: "PROJ-1" },
  jira_manage_issue_link: { action: "create", issue_key: "PROJ-1" },
  jira_manage_attachment: { action: "upload", issue_key: "PROJ-1" },
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
  it("declares a reviewed agent-result policy for all 50 active tools", () => {
    assert.equal(allToolDefinitions.length, 50);
    assert.deepEqual(
      allToolDefinitions.filter((definition) => !definition.agentResult),
      [],
    );
    assert.equal(
      new Set(allToolDefinitions.map((definition) => definition.name)).size,
      50,
    );

    it("locks the simplified model-facing property sets and schema budget", () => {
      const expectedProperties: Record<string, string[]> = {
        edit: ["path", "edits"],
        jira_search_users: [
          "query",
          "project_key",
          "issue_key",
          "max_results",
          "include_inactive",
        ],
        jira_search_issues: ["jql", "fields", "max_results", "next_page_token"],
        jira_get_issue: [
          "issue_key",
          "fields",
          "include",
          "comment_start_at",
          "worklog_start_at",
          "changelog_start_at",
          "related_limit",
        ],
        jira_get_project: [
          "project_key",
          "include",
          "issue_type",
          "field_query",
          "field_limit",
        ],
        task_start: ["command", "name", "cwd", "env", "ready", "timeoutMs"],
        task_status: ["tasks", "status", "limit"],
        task_logs: [
          "task",
          "mode",
          "cursor",
          "contains",
          "contextLines",
          "limit",
        ],
        task_control: ["task", "action"],
        confluence_get_page: [
          "page_id",
          "body_format",
          "include",
          "comment_limit",
          "comment_cursor",
          "markdown",
        ],
        confluence_download_page: [
          "page_id",
          "body_format",
          "markdown",
          "attachments",
        ],
      };
      for (const [name, expected] of Object.entries(expectedProperties)) {
        const schema = requireToolDefinition(name as never).parameters as {
          properties?: Record<string, unknown>;
        };
        assert.deepEqual(Object.keys(schema.properties ?? {}), expected, name);
      }

      for (const definition of allToolDefinitions) {
        const properties = Object.keys(
          (definition.parameters as { properties?: Record<string, unknown> })
            .properties ?? {},
        );
        if (
          definition.name.startsWith("jira_") ||
          definition.name.startsWith("confluence_")
        ) {
          assert.equal(
            properties.includes("save_to_file"),
            false,
            definition.name,
          );
        }
      }

      const searchSchema = requireToolDefinition("jira_search_issues")
        .parameters as {
        properties?: Record<string, { description?: string }>;
      };
      assert.match(
        searchSchema.properties?.jql?.description ?? "",
        /field restriction.*ORDER-BY/i,
      );

      const editSchemaSize = JSON.stringify(
        requireToolDefinition("edit").parameters,
      ).length;
      const catalogSchemaSize = allToolDefinitions.reduce(
        (total, definition) =>
          total + JSON.stringify(definition.parameters).length,
        0,
      );
      assert.ok(
        editSchemaSize <= 800,
        `edit schema is ${editSchemaSize} chars`,
      );
      assert.ok(
        catalogSchemaSize <= 31_000,
        `catalog schemas total ${catalogSchemaSize} chars`,
      );
    });
  });

  it("uses a JSON object root for every tool definition", () => {
    for (const definition of allToolDefinitions) {
      const serialized = JSON.parse(JSON.stringify(definition.parameters)) as {
        type?: unknown;
      };
      assert.equal(serialized.type, "object", definition.name);
    }
  });

  it("keeps plan_mode_present limited to the plan file path", () => {
    const schema = requireToolDefinition("plan_mode_present").parameters;
    assert.equal(Check(schema, { file_path: "/tmp/plan.md" }), true);
    assert.equal(
      Check(schema, { file_path: "/tmp/plan.md", summary: "override" }),
      false,
    );
    assert.equal(
      Check(schema, { file_path: "/tmp/plan.md", title: "override" }),
      false,
    );
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
