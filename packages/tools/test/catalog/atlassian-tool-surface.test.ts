import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Check } from "typebox/value";
import { requireToolDefinition } from "../../src/catalog/manifest.js";

function accepts(toolName: string, args: Record<string, unknown>): boolean {
  return Check(requireToolDefinition(toolName).parameters, args);
}

describe("Atlassian single-target tool schemas", () => {
  it("uses provider-compatible closed Jira action objects", () => {
    assert.equal(
      accepts("jira_manage_comment", {
        action: "delete",
        issue_key: "PROJ-1",
        comment_id: "10",
      }),
      true,
    );
    assert.equal(
      accepts("jira_manage_comment", {
        action: "archive",
        issue_key: "PROJ-1",
      }),
      false,
    );
    assert.equal(
      accepts("jira_manage_comment", {
        action: "delete",
        issue_key: "PROJ-1",
        unsupported: true,
      }),
      false,
    );
    assert.equal(
      accepts("jira_manage_backlog", {
        action: "move_to_sprint",
        issue_key: ["PROJ-1", "PROJ-2"],
        sprint_id: "2",
      }),
      false,
    );
  });

  it("uses provider-compatible closed Confluence action objects", () => {
    assert.equal(accepts("confluence_download_page", { page_id: "123" }), true);
    assert.equal(
      accepts("confluence_download_page", {
        page_id: "123",
        recurse: true,
      }),
      false,
    );
    assert.equal(
      accepts("confluence_manage_label", {
        action: "add",
        page_id: "123",
        label: ["one", "two"],
      }),
      false,
    );
    assert.equal(
      accepts("confluence_manage_label", {
        action: "replace",
        page_id: "123",
        label: "one",
      }),
      false,
    );
  });
});
