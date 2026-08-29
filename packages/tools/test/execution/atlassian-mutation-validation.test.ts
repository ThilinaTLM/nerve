import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeConfluenceManageAttachment,
  executeConfluenceManageComment,
} from "../../src/execution/confluence/confluence.js";
import {
  executeJiraManageAttachment,
  executeJiraManageBacklog,
  executeJiraManageComment,
  executeJiraManageSprint,
} from "../../src/execution/jira/jira.js";

const context = {
  cwd: process.cwd(),
  getApiKey: async () => "secret-token",
  getProviderConfig: async () => ({
    enabled: true,
    siteUrl: "https://example.atlassian.net",
    email: "developer@example.com",
  }),
};

async function rejectsBeforeRequest(
  execute: () => Promise<unknown>,
  expected: RegExp,
) {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({});
  };
  try {
    await assert.rejects(execute, expected);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("Atlassian action-specific mutation validation", () => {
  it("requires a Jira sprint name before creating a sprint", async () => {
    await rejectsBeforeRequest(
      () =>
        executeJiraManageSprint({ action: "create", board_id: "12" }, context),
      /name must be a non-empty string/,
    );
  });

  it("retains Jira comment and backlog conditional requirements", async () => {
    await rejectsBeforeRequest(
      () =>
        executeJiraManageComment(
          { action: "update", issue_key: "PROJ-1", body: "Changed" },
          context,
        ),
      /comment_id is required/,
    );
    await rejectsBeforeRequest(
      () =>
        executeJiraManageBacklog(
          { action: "rank", issue_key: "PROJ-1" },
          context,
        ),
      /exactly one rank_before_issue_key or rank_after_issue_key/,
    );
  });

  it("retains Jira attachment action requirements", async () => {
    await rejectsBeforeRequest(
      () =>
        executeJiraManageAttachment(
          { action: "upload", file_path: "attachment.txt" },
          context,
        ),
      /issue_key must be a non-empty string/,
    );
    await rejectsBeforeRequest(
      () => executeJiraManageAttachment({ action: "delete" }, context),
      /attachment_id must be a non-empty string/,
    );
  });

  it("requires a Confluence page before creating a comment", async () => {
    await rejectsBeforeRequest(
      () =>
        executeConfluenceManageComment(
          { action: "create", kind: "footer", body: "Comment" },
          context,
        ),
      /page_id must be a non-empty string/,
    );
  });

  it("retains Confluence attachment action requirements", async () => {
    await rejectsBeforeRequest(
      () =>
        executeConfluenceManageAttachment(
          { action: "rename", page_id: "123", new_filename: "renamed.txt" },
          context,
        ),
      /attachment_id must be a non-empty string/,
    );
  });
});
